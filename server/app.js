import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import path from "path";
import fetch from "node-fetch";

dotenv.config();
const app = express();
const PORT = 5000;

app.use(cors());

// File upload handling
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const imageData = await fs.promises.readFile(imagePath);
    const base64Image = imageData.toString("base64");

    const prompt = `Extract the panel number and names into 2 columns for odd panel numbers and 2 columns for even panel numbers in the format:\nPanel No | Panel Name | Panel No | Panel Name`;

    const requestBody = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
    };

    const response = await fetch(process.env.AZURE_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_OPENAI_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    let rawText = "";
    try {
      rawText = result.choices[0].message.content;
    } catch (e) {
      console.error("Invalid Azure OpenAI response:", result);
      return res.status(500).send("Azure OpenAI failed to generate text.");
    }

    // Process response to extract rows
    const rows = rawText
      .split("\n")
      .filter(line => line.includes("|") && !line.includes("---"))
      .map(line => line.split("|").map(col => col.trim()).filter(col => col !== ""));

    if (rows.length > 0 && rows[0][0].toLowerCase().includes("panel")) {
      rows.shift();
    }

    // Generate Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("PanelBoard");

    worksheet.columns = [
      { header: "Panel No (Odd)", key: "oddNo", width: 15 },
      { header: "Panel Name (Odd)", key: "oddName", width: 35 },
      { header: "Panel No (Even)", key: "evenNo", width: 15 },
      { header: "Panel Name (Even)", key: "evenName", width: 35 },
    ];

    rows.forEach((cols) => {
      const [oddNo, oddName, evenNo, evenName] = cols.concat(Array(4 - cols.length).fill(''));
      worksheet.addRow({ oddNo, oddName, evenNo, evenName });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Panel_Board_Listing.xlsx");
    res.send(buffer);

    fs.unlinkSync(imagePath);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Failed to process image: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});