const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const lark = require('@larksuiteoapi/node-sdk');

dotenv.config();

const app = express();
app.use(cors());

// 飞书 SDK 客户端初始化
const larkClient = new lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
});

// Zhipu AI 客户端
const aiClient = new OpenAI({
    apiKey: process.env.ZHIPU_API_KEY,
    baseURL: "https://open.bigmodel.cn/api/paas/v4/"
});

// 飞书用户对话上下文管理 (简单内存实现)
const userContexts = new Map();
const MAX_CONTEXT_LEN = 10; // 每个用户保留最近10条消息
const CONTEXT_TIMEOUT = 10 * 60 * 1000; // 10分钟不说话自动清除上下文

// 解析 JSON
app.use(express.json());
// 飞书 Webhook 需要处理特定格式，如果是处理事件，通常建议使用 SDK 提供的 Dispatcher
const eventDispatcher = new lark.EventDispatcher({
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
}).register({
    'im.message.receive_v1': async (data) => {
        const { message, sender } = data;
        const text = JSON.parse(message.content).text;
        const openId = sender.sender_id.open_id;

        // 获取或初始化上下文
        let context = userContexts.get(openId) || { messages: [], lastUpdate: Date.now() };
        
        // 如果超时，重置上下文
        if (Date.now() - context.lastUpdate > CONTEXT_TIMEOUT) {
            context = { messages: [], lastUpdate: Date.now() };
        }

        // 添加用户当前消息
        context.messages.push({ role: "user", content: text });
        context.lastUpdate = Date.now();

        try {
            // 调用 AI 获取回复 (带上历史记录)
            const response = await aiClient.chat.completions.create({
                model: "glm-4-flash",
                messages: context.messages,
            });
            const aiReply = response.choices[0].message.content;

            // 添加 AI 回复到上下文
            context.messages.push({ role: "assistant", content: aiReply });

            // 保持上下文长度
            if (context.messages.length > MAX_CONTEXT_LEN) {
                context.messages = context.messages.slice(-MAX_CONTEXT_LEN);
            }

            // 更新内存存储
            userContexts.set(openId, context);

            // 构建飞书消息卡片
            const cardContent = {
                config: { wide_screen_mode: true },
                header: {
                    title: { content: "AI 助手回复", tag: "plain_text" },
                    template: "blue"
                },
                elements: [
                    {
                        tag: "div",
                        text: { content: aiReply, tag: "lark_md" }
                    },
                    {
                        tag: "hr"
                    },
                    {
                        tag: "note",
                        elements: [
                            {
                                tag: "plain_text",
                                content: `上下文消息：${context.messages.length}条 | GLM-4-Flash 提供支持`
                            }
                        ]
                    }
                ]
            };

            // 回复飞书消息 (使用 interactive 消息类型即消息卡片)
            await larkClient.im.message.reply({
                path: { message_id: message.message_id },
                data: {
                    content: JSON.stringify(cardContent),
                    msg_type: 'interactive',
                },
            });
        } catch (error) {
            console.error('飞书回复失败:', error);
        }
    },
});

// 飞书事件订阅 Webhook 接口
app.post('/api/feishu/webhook', (req, res, next) => {
    // 处理飞书的 URL 验证（Challenge）
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send({
            challenge: req.body.challenge
        });
    }
    // 其他事件交给 SDK 处理
    lark.adaptExpress(eventDispatcher)(req, res, next);
});

// 主动发消息接口
app.post('/api/feishu/push', async (req, res) => {
    const { user_id, text } = req.body;
    const targetUserId = user_id || process.env.FEISHU_USER_ID;
    
    if (!targetUserId || !text) {
        return res.status(400).json({ success: false, error: '缺少 user_id (或 FEISHU_USER_ID 环境变量) 或 text' });
    }

    try {
        const result = await larkClient.im.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
                receive_id: targetUserId,
                content: JSON.stringify({ text: text }),
                msg_type: 'text',
            },
        });
        res.json({ success: true, msg: '消息发送成功', result });
    } catch (error) {
        console.error('主动发送失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    try {
        const response = await aiClient.chat.completions.create({
            model: "glm-4-flash",
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
