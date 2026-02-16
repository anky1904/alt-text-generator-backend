const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

// ===== Daily limit store =====
let ipStore = {};

function resetIfNewDay(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (!ipStore[ip] || ipStore[ip].date !== today) {
    ipStore[ip] = { count: 0, date: today };
  }
}

// ===== Extract JSON safely =====
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

// ===== Health check =====
app.get("/", (req, res) => {
  res.send("Alt Text Generator Backend Running");
});

// ===== Main API =====
app.post("/generate-alt", async (req, res) => {
  try {
    const { images = [] } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const internalKey = req.headers["x-internal-key"];

    // Public daily limit
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
        let geminiResponse;

        try {
          // Try Vision mode (download image)
          const imageResponse = await axios.get(img, {
            responseType: "arraybuffer",
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          const base64Image = Buffer.from(imageResponse.data).toString("base64");
          const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

          geminiResponse = await axios.post(
            "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
            {
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    {
                      text: `
Return ONLY JSON:

{
  "alt_text": "SEO alt text under 100 chars",
  "score": number 0-100,
  "issues": "short issue or None",
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
          // Fallback: text-only mode
          geminiResponse = await axios.post(
            "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
            {
              contents: [
                {
                  parts: [
                    {
                      text: `
Generate SEO alt text for this image URL:

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
