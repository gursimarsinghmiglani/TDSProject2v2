import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import csvParser from 'csv-parser';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const form = formidable();

    form.parse(req, async (err, fields, files) => {
        if (err) return res.status(500).json({ error: 'Form parsing error' });

        const question = fields.question;
        if (!question) return res.status(400).json({ error: 'Missing question' });

        let extractedAnswer = '';

        try {
            if (files.file) {
                const filePath = files.file[0].filepath;
                const fileName = files.file[0].originalFilename;
                const ext = path.extname(fileName);

                const tempDir = path.join('/tmp', 'unzipped_' + Date.now());
                fs.mkdirSync(tempDir, { recursive: true });

                if (ext === '.zip') {
                    await new Promise((resolve, reject) => {
                        fs.createReadStream(filePath)
                            .pipe(unzipper.Extract({ path: tempDir }))
                            .on('close', resolve)
                            .on('error', reject);
                    });
                } else {
                    fs.copyFileSync(filePath, path.join(tempDir, fileName));
                }

                const csvFile = fs.readdirSync(tempDir).find(f => f.endsWith('.csv'));
                if (csvFile) {
                    const csvPath = path.join(tempDir, csvFile);
                    extractedAnswer = await new Promise((resolve, reject) => {
                        fs.createReadStream(csvPath)
                            .pipe(csvParser())
                            .on('data', row => {
                                if (row.answer) resolve(row.answer);
                            })
                            .on('end', () => resolve(null))
                            .on('error', reject);
                    });
                }
            }
        } catch (e) {
            return res.status(500).json({ error: 'File processing failed' });
        }

        const prompt = `${question}
                        ${extractedAnswer ? `\nExtracted data: ${extractedAnswer}` : ''}

                            IMPORTANT: Respond with ONLY the final answer. No explanation. No formatting. No punctuation. No quotes. Just the answer.`;

        try {
            const response = await fetch(
                'https://aiproxy.sanand.workers.dev/openai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${process.env.AI_PROXY_TOKEN}`,
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0,
                    }),
                }
            );

            const data = await response.json();
            const raw = data.choices?.[0]?.message?.content?.trim() || 'No answer';
            const cleaned = raw
                .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '') // remove quotes
                .replace(/^the answer is\s*/i, '')        // remove 'The answer is'
                .trim();

            return res.status(200).json({ answer: cleaned });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'AI Proxy failed' });
        }
    });
}