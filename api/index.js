// File: api/index.js
const express = require("express");
const formidable = require("formidable");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const csvParser = require("csv-parser");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

app.post("/api", (req, res) => {
    const form = formidable({ multiples: false });

    form.parse(req, async (err, fields, files) => {
        if (err) return res.status(500).json({ error: "Form parsing error" });

        const question = fields.question;
        if (!question) return res.status(400).json({ error: "Missing question" });

        let extractedAnswer = "";

        try {
            if (files.file) {
                const filePath = files.file.filepath || files.file.path;
                const fileName = files.file.originalFilename || files.file.name;
                const ext = path.extname(fileName);

                const tempDir = path.join("/tmp", "extracted_" + Date.now());
                fs.mkdirSync(tempDir, { recursive: true });

                if (ext === ".zip") {
                    await new Promise((resolve, reject) => {
                        fs.createReadStream(filePath)
                            .pipe(unzipper.Extract({ path: tempDir }))
                            .on("close", resolve)
                            .on("error", reject);
                    });
                } else {
                    fs.copyFileSync(filePath, path.join(tempDir, fileName));
                }

                const csvFile = fs.readdirSync(tempDir).find((f) => f.endsWith(".csv"));
                if (csvFile) {
                    const csvPath = path.join(tempDir, csvFile);
                    extractedAnswer = await new Promise((resolve, reject) => {
                        fs.createReadStream(csvPath)
                            .pipe(csvParser())
                            .on("data", (row) => {
                                if (row.answer) resolve(row.answer);
                            })
                            .on("end", () => resolve(null))
                            .on("error", reject);
                    });
                }
            }
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "File processing error" });
        }

        const prompt = extractedAnswer
            ? `${question}\n\nExtracted answer from CSV: ${extractedAnswer}\nRespond with only a single number.`
            : `${question}\nRespond with only a single number.`;

        try {
            const aiRes = await fetch(process.env.AI_PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.AI_PROXY_TOKEN}`,
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.0,
                }),
            });

            const json = await aiRes.json();
            const text = json.choices?.[0]?.message?.content?.trim();
            const number = text?.match(/\d+/)?.[0] || "No numeric answer";

            return res.status(200).json({ answer: number });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "AI Proxy error" });
        }
    });
});

module.exports = app;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}/api`);
});