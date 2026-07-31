import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig, para os testes importarem como o app importa.
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    // O pdfjs avisa sobre canvas e fontes padrão a cada documento lido. Não
    // afeta a extração de texto (as larguras medidas são idênticas com e sem
    // as fontes), mas afogaria a saída dos testes. Filtra só esse ruído
    // conhecido — qualquer outra saída continua visível.
    onConsoleLog: (log) =>
      !/Cannot polyfill|fetchStandardFontData|standardFontDataUrl|Require stack|pdfjs-dist/.test(log),
  },
})
