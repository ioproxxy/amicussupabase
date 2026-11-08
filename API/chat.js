export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const response = await fetch(
      `${process.env.OLLAMA_BASE_URL}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
          messages: [
            {
              role: "user",
              content: req.body.message
            }
          ],
          stream: false
        })
      }
    );

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}