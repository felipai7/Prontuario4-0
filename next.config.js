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
    // Garante que os ARQUIVOS do pdfjs viajem para o servidor da Vercel.
    //
    // `serverComponentsExternalPackages` tira o pdfjs do empacotamento, então
    // ele é carregado de node_modules em tempo de execução. Quem decide o que
    // vai junto no deploy é o rastreamento de arquivos do Next, que segue
    // `require`/`import` — e o pdfjs carrega parte do seu conteúdo por caminho,
    // em tempo de execução. O que o rastreamento não vê, não sobe.
    //
    // HIPÓTESE, não diagnóstico fechado (04/08/2026): o mesmo laudo do IMEC que
    // extrai 54 resultados aqui falhou em produção. PDF, extrator e versão do
    // código foram descartados um a um; sobrou a diferença de ambiente. Se a
    // causa for esta, isto resolve; se não for, não custa nada — o pdfjs
    // continua sendo carregado igual, só com a certeza de que os arquivos
    // existem lá. A mensagem de erro agora nomeia a causa (ver
    // `mensagemNaoReconhecido`), então o próximo envio confirma ou refuta.
    outputFileTracingIncludes: {
      '/api/extract-exam': ['./node_modules/pdfjs-dist/legacy/build/**'],
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}
module.exports = nextConfig
