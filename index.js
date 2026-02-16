for (const img of images) {
  try {
    let geminiResponse;

    try {
      // 🔹 Try downloading image for Vision mode
      const imageResponse = await axios.get(img, {
        responseType: "arraybuffer",
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const base64Image = Buffer.from(imageResponse.data).toString("base64");
      const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

      // 🔹 Vision request
      geminiResponse = await axios.post(
        "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
        {
          contents: [
            {
              parts: [
                { inlineData: { mimeType, data: base64Image } },
                {
                  text: `
Return ONLY valid JSON.

{
  "alt_text": "SEO friendly alt text under 100 characters including keyword and brand",
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
      // 🔹 Fallback: URL-based description if image blocked
      geminiResponse = await axios.post(
        "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
        {
          contents: [
            {
              parts: [
                {
                  text: `
Generate SEO image alt text from this image URL:

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
