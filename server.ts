import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

function cleanString(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Gemini evaluate guess proxy
app.post("/api/gemini/evaluate-guess", async (req, res) => {
  const { targetName, guess, category } = req.body;
  if (!targetName || !guess) {
    return res.status(400).json({ error: "Missing targetName or guess" });
  }

  const cleanTarget = cleanString(targetName);
  const cleanGuess = cleanString(guess);

  // 1. Direct exact match
  if (cleanTarget === cleanGuess) {
    return res.json({ isMatch: true, explanation: "Exact match" });
  }

  // 2. Simple character-by-character similarity heuristic
  if (cleanGuess.length >= 4 && (cleanTarget.includes(cleanGuess) || cleanGuess.includes(cleanTarget))) {
    return res.json({ isMatch: true, explanation: "Sub-string matching" });
  }

  // 3. Gemini AI Matching
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.log("GEMINI_API_KEY is not configured or placeholder. Skipping AI semantic match.");
    return res.json({ isMatch: false, explanation: "Incorrect guess (local validation)" });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const categoryContext = category ? `The category of the secret character is: ${category}.` : '';

    const prompt = `You are a strict but fair game referee checking if a player's guess matches the target character's name in a trivia game.
Target character: "${targetName}"
Player's guess: "${guess}"
${categoryContext}

Compare them. You should return isMatch: true if they refer to the exact same entity (e.g., spelling mistakes, spelling variations, aliases).
Otherwise, return isMatch: false.

Return a JSON object exactly like this:
{
  "isMatch": boolean,
  "explanation": "brief description of why"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text || "{}";
    const result = JSON.parse(responseText.trim());
    return res.json({
      isMatch: !!result.isMatch,
      explanation: result.explanation || "AI semantic matching evaluated"
    });
  } catch (error: any) {
    console.error("Gemini semantic verification error:");
    console.error(error.stack || error);
    return res.json({ isMatch: false, explanation: "AI comparison failed, falling back to local validation" });
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

startServer();
