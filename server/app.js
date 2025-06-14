import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import path from "path";

dotenv.config();
const app = express();
const PORT = 5000;

app.use(cors());

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// The API key will be provided by the Canvas environment for the Gemini API call
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // No longer needed for OpenAI

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;

    const imageData = await fs.promises.readFile(imagePath);
    const base64Image = imageData.toString("base64");

    // Gemini API integration
    const chatHistory = [];
    chatHistory.push({
      role: "user",
      parts: [
        // Corrected structure: directly use 'text' for text content
        { text: "Extract the panel number and names into 2 columns for odd panel numbers and 2 columns for even panel numbers in the format:\nPanel No | Panel Name | Panel No | Panel Name" },
        // Corrected structure: directly use 'inlineData' for image content
        {
          inlineData: {
            mimeType: "image/jpeg", // Assuming the input is always JPEG, adjust if other types are possible
            data: base64Image
          }
        }
      ]
    });

    const payload = { contents: chatHistory };
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await geminiResponse.json();

    let rawText = "";
    if (result.candidates && result.candidates.length > 0 &&
        result.candidates[0].content && result.candidates[0].content.parts &&
        result.candidates[0].content.parts.length > 0) {
      rawText = result.candidates[0].content.parts[0].text;
    } else {
      console.error("Unexpected Gemini API response structure or no content:", result);
      return res.status(500).send("Failed to get text from Gemini API. Unexpected response structure.");
    }

    // Parse LLM result line by line
    const rows = rawText
      .split("\n")
      .filter((line) => line.includes("|") && !line.includes("---")) // Filter for actual data rows, ignoring markdown table separator
      .map((line) => line.split("|").map(col => col.trim()).filter(col => col !== '')); // Split by '|' and trim whitespace, remove empty strings from filtering


    // Check if header row is present and remove it if it is the first row
    if (rows.length > 0 && (rows[0][0] === "Panel No (Odd)" || rows[0][0] === "Panel No" || rows[0][0] === "Panel No (Even)")) {
        rows.shift(); // Remove the header row if it's there
    }

    // Create Excel sheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("PanelBoard");

    worksheet.columns = [
      { header: "Panel No (Odd)", key: "oddNo", width: 15 },
      { header: "Panel Name (Odd)", key: "oddName", width: 35 },
      { header: "Panel No (Even)", key: "evenNo", width: 15 },
      { header: "Panel Name (Even)", key: "evenName", width: 35 },
    ];

    rows.forEach((cols) => {
      // Ensure cols has at least 4 elements, pad with empty strings if not
      const [oddNo, oddName, evenNo, evenName] = cols.concat(Array(4 - cols.length).fill(''));
      worksheet.addRow({
        oddNo: oddNo,
        oddName: oddName,
        evenNo: evenNo,
        evenName: evenName,
      });
    });

    // Write Excel to buffer and send
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Panel_Board_Listing.xlsx");
    res.send(buffer);

    // Clean up uploaded image
    fs.unlinkSync(imagePath);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Something went wrong while processing the image: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
