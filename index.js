const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory IP usage store
let ipStore = {};

// Reset counts daily
function resetIfNewDay(ip) {
  const today = new Date().toISOString().slice(0, 10);

  if (!ipStore[ip] || ipStore[ip].date !== today) {
    ipStore[ip] = { count: 0, date: today };
  }
}

app.get("/", (req, res) => {
  res.send("Alt Text Generator Backend Running");
});

app.post("/generate-alt", async (req, res) => {
  try {
    const { images = [], context = {} } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const internalKey = req.headers["x-internal-key"];

    // Public users → 30 images/day limit
    if (internalKey !== process.env.INTERNAL_KEY) {
      resetIfNewDay(ip);

      if (ipStore[ip].count + images.length > 30) {
        return res.status(429).json({ error: "Daily limit reached (30 images)." });
      }

      ipStore[ip].count += images.length;
    }

    const results = [];

    for (const img of images) {
      try {
        const geminiResponse = await axios.post(
          "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
          {
            contents: [
              {
                parts: [
                  {
                    text: `
Return ONLY valid JSON. No explanation.

Format:
{
  "alt_text": "SEO friendly alt text under 100 characters including keyword and brand",
  "score": number from 0-100,
  "issues": "short issue description or None",
  "filename": "seo-optimized-file-name.jpg"
}

Context:
${JSON.stringify(context)}

Image URL:
${img}
`
                  }
                ]
              }
            ]
          },
          {
            params: { key: process.env.GEMINI_API_KEY }
          }
        );

        const rawText =
          geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

        let parsed;

        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = {
            alt_text: rawText,
            score: "",
            issues: "",
            filename: ""
          };
        }

        results.push({
          image: img,
          alt_text: parsed.alt_text || "",
          score: parsed.score || "",
          issues: parsed.issues || "",
          filename: parsed.filename || ""
        });
      } catch (err) {
        results.push({
          image: img,
          alt_text: "Error generating alt text",
          score: "",
          issues: "Gemini request failed",
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
