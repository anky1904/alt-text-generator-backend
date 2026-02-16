const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

/* ================= DAILY LIMIT STORE ================= */

let ipStore = {};

function resetIfNewDay(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (!ipStore[ip] || ipStore[ip].date !== today) {
    ipStore[ip] = { count: 0, date: today };
  }
}

/* ================= JSON EXTRACTION ================= */

function extractJSON(text) {
  if (!text) return null;

  text = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

/* ================= HELPER: delay ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ================= HELPER: Gemini call with retry ================= */

async function callGemini(payload) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.post(
        "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",
        payload,
        { params: { key: process.env.GEMINI_API_KEY } }
      );

      return res;
    } catch (err) {
      if (attempt === 2) throw err;

      // wait before retry (rate limit protection)
      await sleep(1500);
    }
  }
}

/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.send("Alt Text Generator Backend Running");
});

/* ================= MAIN API ================= */

app.post("/generate-alt", async (req, res) => {
  try {
    const { images = [] } = req.body;

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const internalKey = req.headers["x-internal-key"];

    const isOwner = internalKey === process.env.INTERNAL_KEY;

    /* ===== PUBLIC LIMIT: 10 PER DAY ===== */
    if (!isOwner) {
      resetIfNewDay(ip);

      if (ipStore[ip].count + images.length > 10) {
        return res
          .status(429)
          .json({ error: "Daily quota limit exceeded (10 images per day)." });
      }

      ipStore[ip].count += images.length;
    }

    const results = [];

    for (const img of images) {
      try {
        /* ===== Extract product name ===== */
        const productName = img
          .split("/")
          .pop()
          .split("?")[0]
          .replace(/[-_]/g, " ")
          .replace(/\.(jpg|jpeg|png|webp|gif)/i, "")
          .trim();

        let geminiResponse;

        try {
          /* ===== Vision mode ===== */
          const imageResponse = await axios.get(img, {
            responseType: "arraybuffer",
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          const base64Image = Buffer.from(imageResponse.data).toString("base64");
          const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

          geminiResponse = await callGemini({
            contents: [
              {
                parts: [
                  { inlineData: { mimeType, data: base64Image } },
                  {
                    text: `
You are an expert eCommerce SEO specialist.

Product name:
"${productName}"

Generate SEO alt text under 100 characters.
Must start with product name.
No hallucination.

Return ONLY JSON:
{
  "alt_text": "...",
  "score": number,
  "issues": "...",
  "filename": "seo-file-name.jpg"
}
`
                  }
                ]
              }
            ]
          });
        } catch {
          /* ===== Fallback text mode ===== */
          geminiResponse = await callGemini({
            contents: [
              {
                parts: [
                  {
                    text: `
Generate SEO alt text for product:
"${productName}"

Image URL:
${img}

Return ONLY JSON:
{
  "alt_text": "...",
  "score": number,
  "issues": "...",
  "filename": "seo-file-name.jpg"
}
`
                  }
                ]
              }
            ]
          });
        }

        const rawText =
          geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        const parsed = extractJSON(rawText);

        if (parsed) {
          results.push({
            image: img,
            alt_text: parsed.alt_text || "",
            score: parsed.score || "",
            issues: parsed.issues || "",
            filename: parsed.filename || ""
          });
        } else {
          results.push({
            image: img,
            alt_text: rawText || "Alt text not generated",
            score: "",
            issues: "Invalid AI response",
            filename: ""
          });
        }

        // 🔹 Delay between images → prevents Gemini rate limit
        await sleep(1200);

      } catch {
        results.push({
          image: img,
          alt_text: "Failed after retry",
          score: "",
          issues: "Gemini temporary failure",
          filename: ""
        });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
