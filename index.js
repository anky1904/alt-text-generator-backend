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

// ===== Health route =====
app.get("/", (req, res) => {
  res.send("Alt Text Generator Backend Running");
});

// ===== Main route =====
app.post("/generate-alt", async (req, res) => {
  try {
    const { images = [], context = {} } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const internalKey = req.headers["x-internal-key"];

    // Public limit
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
        // 🔹 Download image
        const imageResponse = await axios.get(img, {
          responseType: "arraybuffer",
          timeout: 10000
        });

        const base64Image = Buffer.from(imageResponse.data).toString("base64");
        const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

        // 🔹 Gemini Vision call
        const geminiResponse = await axios.post(
          "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
          {
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64Image
                    }
                  },
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
`
                  }
                ]
              }
            ]
          },
          {
            params: { key: process.env.GEMINI_API_KEY },
            timeout: 20000
          }
        );

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
            issues: "Invalid AI response format",
            filename: ""
          });
        }
      } catch (err) {
        results.push({
          image: img,
          alt_text: "Error generating alt text",
          score: "",
          issues: "Image or Gemini request failed",
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
