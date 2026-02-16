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
        let geminiResponse;

        /* ===== Extract product name from URL ===== */
        const productName = img
          .split("/")
          .pop()
          .split("?")[0]
          .replace(/[-_]/g, " ")
          .replace(/\.(jpg|jpeg|png|webp|gif)/i, "")
          .trim();

        try {
          /* ===== TRY VISION MODE ===== */

          const imageResponse = await axios.get(img, {
            responseType: "arraybuffer",
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          const base64Image = Buffer.from(imageResponse.data).toString("base64");
          const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

          geminiResponse = await axios.post(
            "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",
            {
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    {
                      text: `
You are an expert eCommerce SEO specialist.

Product name:
"${productName}"

TASK:
Generate SEO-optimized ALT TEXT.

RULES:
- MUST start with product name.
- Under 100 characters.
- No hallucination.
- Natural and keyword rich.

Return ONLY JSON:

{
  "alt_text": "...",
  "score": number 0-100,
  "issues": "None or short issue",
  "filename": "seo-file-name.jpg"
}
`
                    }
                  ]
                }
              ]
            },
            { params: { key: process.env.GEMINI_API_KEY } }
          );
        } catch {
          /* ===== FALLBACK TEXT MODE ===== */

          geminiResponse = await axios.post(
            "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",
            {
              contents: [
                {
                  parts: [
                    {
                      text: `
You are an expert eCommerce SEO specialist.

Product name:
"${productName}"

Generate correct SEO ALT TEXT for image URL:

${img}

Return ONLY JSON:

{
  "alt_text": "...",
  "score": number 0-100,
  "issues": "...",
  "filename": "seo-file-name.jpg"
}
`
                    }
                  ]
                }
              ]
            },
            { params: { key: process.env.GEMINI_API_KEY } }
          );
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
      } catch {
        results.push({
          image: img,
          alt_text: "Failed completely",
          score: "",
          issues: "Gemini error",
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
