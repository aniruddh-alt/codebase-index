import { NextRequest, NextResponse } from 'next/server';
import dotenv from 'dotenv';
import * as fs from 'fs';
import {msg} from "../../../lib/types";

dotenv.config();

const system_prompt = fs.readFileSync('./src/lib/instructions.txt', 'utf-8');

// OpenRouter
const OPEN_ROUTER_KEY = process.env.OPEN_ROUTER_KEY;

export async function POST(req: NextRequest) {
    const messagesData = await req.json();
    
    // OpenRouter format
    const formattedContents = messagesData.messages.map((msg: msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
    }));

    try {
        /// OpenRouter
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${OPEN_ROUTER_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'openai/gpt-oss-20b:free',
              messages: [{role: 'system', content: system_prompt}, ...formattedContents],
              stream: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter error:', errorText);
            return NextResponse.json({ error: errorText }, { status: response.status });
        }

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    if (!response.body) {
                        throw new Error('Response body is null');
                    }
                    
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Decode the chunk and add to buffer
                        buffer += decoder.decode(value, { stream: true });
                        
                        // Process complete lines
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ''; // Keep incomplete line in buffer
                        
                        for (const line of lines) {
                            if (!line.trim()) continue;
                            if (line.includes('data: [DONE]') || line.includes(': OPENROUTER PROCESSING')) continue;
                            
                            // Extract the JSON data from the line
                            if (line.startsWith('data: ')) {
                                try {
                                    const jsonData = JSON.parse(line.substring(6));
                                    if (jsonData.choices && jsonData.choices[0]) {
                                        const content = jsonData.choices[0].delta?.content || '';
                                        if (content) {
                                            controller.enqueue(new TextEncoder().encode(content));
                                        }
                                    }
                                } catch (e) {
                                    // Skip malformed JSON
                                }
                            }
                        }
                    }

                    controller.close();
                } catch (error) {
                    console.error('Stream error:', error);
                    controller.error(error);
                }
            }
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked'
            }
        });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error('API error:', error);
        return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
    }
}
