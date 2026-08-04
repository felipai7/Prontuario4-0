/** @type {import('next').NextConfig} */
const nextConfig = {
  // O pdfjs é usado SÓ no servidor, pela extração de exames, e não pode ser
  // empacotado: ele faz `require('canvas')` para renderizar página em imagem —
  // recurso que não usamos — e o webpack não resolve isso, quebrando o build de
  // produção inteiro.
  //
  // Só apareceu ao rodar `npm run build`. Em Node puro, que é onde os testes
  // rodam, o require opcional falha em silêncio e a extração funciona.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}
module.exports = nextConfig
