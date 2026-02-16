const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

/* ================= DAILY LIMIT ================= */

let ipStore = {};

function resetIfNewDay(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (!ipStore[ip] || ipStore[ip].date !== today) {
    ipStore[ip] = { count: 0, date: today };
  }
}

/* ================= JSON PARSER ================= */

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

/* ================= GEMINI TEXT CALL ================= */

async function generateAltText(productName, url) {
  const res = await axios.post(
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

Image URL:
${url}

Generate an SEO alt text:

RULES:
- MUST start with product name
- Under 100 characters
- No hallucination
- Natural ecommerce wording

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
    },
    { params: { key: process.env.GEMINI_API_KEY } }
  );

  const raw =
    res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return extractJSON(raw);
}

/* ================= HEALTH ================= */

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

    /* ===== PUBLIC LIMIT ===== */
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

    /* ===== PROCESS IMAGES ONE BY ONE (TEXT MODE ONLY) ===== */

    for (const img of images) {
      try {
        const productName = img
          .split("/")
          .pop()
          .split("?")[0]
          .replace(/[-_]/g, " ")
          .replace(/\.(jpg|jpeg|png|webp|gif)/i, "")
          .trim();

        const parsed = await generateAltText(productName, img);

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
            alt_text: "Alt text not generated",
            score: "",
            issues: "Invalid AI response",
            filename: ""
          });
        }
      } catch {
        results.push({
          image: img,
          alt_text: "Generation failed",
          score: "",
          issues: "Gemini API limit",
          filename: ""
        });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
