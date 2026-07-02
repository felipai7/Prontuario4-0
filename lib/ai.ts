// Cliente Gemini compartilhado pelas rotas de API.
// Uso exclusivo no servidor — nunca importar em Client Components
// (depende de GOOGLEAISTUDIO_API_KEY, que não é exposta ao browser).

import { GoogleGenAI } from '@google/genai'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b']

/** Lança erro se a API key não estiver configurada. */
export function getAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLEAISTUDIO_API_KEY
  if (!apiKey) throw new Error('Google AI API Key não configurada')
  return new GoogleGenAI({ apiKey })
}

/**
 * Gera conteúdo tentando cada modelo em ordem; só faz fallback em
 * erro de sobrecarga (503/UNAVAILABLE/overload) — outros erros sobem direto.
 * Aceita um prompt de texto ou um array multimodal (inlineData + texto).
 */
export async function generateWithFallback(ai: GoogleGenAI, input: string | any[]): Promise<string> {
  const contents = typeof input === 'string' ? [input] : input
  let lastErr: Error | null = null
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({ model, contents })
      return response.text?.trim() ?? ''
    } catch (e: any) {
      lastErr = e
      if (!e.message?.includes('503') && !e.message?.includes('UNAVAILABLE') && !e.message?.includes('overload')) throw e
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw lastErr
}
