import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

function cleanString(str: any): string {
  if (typeof str !== "string") str = String(str || "");
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function levenshteinDistance(a: string, b: string): number {
  const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) track[0][i] = i;
  for (let j = 0; j <= b.length; j++) track[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  return track[b.length][a.length];
}

// Gemini evaluate guess proxy
app.post("/api/gemini/evaluate-guess", async (req, res) => {
  try {
    console.log("Received guess request:", req.body);
    const { targetName, guess, category } = req.body;
    if (!targetName || !guess) {
      console.warn("Missing targetName or guess:", req.body);
      return res.status(400).json({ error: "Missing targetName or guess" });
    }

    const cleanTarget = cleanString(targetName);
    const cleanGuess = cleanString(guess);

    // 1. Direct exact match
    if (cleanTarget === cleanGuess) {
      return res.json({ isMatch: true, explanation: "Exact match" });
    }

    // 2. Fuzzy similarity (allow up to 30% difference)
    const distance = levenshteinDistance(cleanTarget, cleanGuess);
    const maxLength = Math.max(cleanTarget.length, cleanGuess.length);
    if (maxLength > 0 && distance <= maxLength * 0.3) {
      return res.json({ isMatch: true, explanation: "Close enough" });
    }

    // 3. Fallback: Not a match
    return res.json({ isMatch: false, explanation: "Incorrect guess (local validation)" });
  } catch (err: any) {
    console.error("Error in evaluate-guess:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Only start the server directly if not running as a Vercel serverless function
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer();
}

export default app;
