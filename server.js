const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const client = new OpenAI({
    apiKey: process.env.ZHIPU_API_KEY,
    baseURL: "https://open.bigmodel.cn/api/paas/v4/"
});

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    try {
        const response = await client.chat.completions.create({
            model: "glm-4.7-flash",
            messages: messages,
        });
        res.json(response.choices[0].message);
    } catch (error) {
        console.error('Error with Zhipu AI:', error);
        res.status(500).json({ error: 'Failed to fetch response from AI' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
