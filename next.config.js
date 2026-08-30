/** @type {import('next').NextConfig} */

// Versao do build, inlinada no bundle do cliente E no do servidor pelo mesmo literal. E o que
// permite ao terminal de ponto perceber que esta rodando codigo velho: ele fica aberto por dias
// numa tela de portaria e nao recarrega sozinho, entao um deploy o deixa para tras.
// Em 09/08/2026 isso fez um terminal continuar chamando fn_confirmar_presenca direto depois da
// v1.22.0 ir ao ar - o servidor via "recusado" e tentava de novo, e a batida nao virava marcacao.
// Usa a versao do package.json de proposito, e nao um timestamp: o valor precisa ser IDENTICO
// nos dois lados. Se o servidor recalculasse a cada requisicao, o terminal recarregaria em loop.
const appVersion = require('./package.json').version;

const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // tools/coletor-rep/dist/ fica FORA de src/ e do rastreamento automatico de arquivos do
  // output:'standalone' - sem isto, /api/coletor-rep/download funciona em `npm run dev` (le do
  // filesystem completo) mas devolve 404/erro no container do Coolify, que roda so o que o
  // standalone empacotou. Estavel desde o Next 15 (nao e mais `experimental`).
  outputFileTracingIncludes: {
    '/api/coletor-rep/download': ['./tools/coletor-rep/dist/**/*'],
    '/api/coletor-rep/download-cli': ['./tools/coletor-rep/dist/**/*'],
    '/api/coletor-rep/tray-version': ['./tools/coletor-rep/dist/**/*'],
    '/api/coletor-rep/tray-download': ['./tools/coletor-rep/dist/**/*'],
  },

  // Cabecalhos de seguranca (achado 16 da auditoria de 30/08/2026 - nao havia NENHUM).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Impede que o SisEscala seja carregado dentro de um <iframe> de outro site
          // (clickjacking: uma pagina externa sobrepoe botoes invisiveis sobre a tela real).
          { key: 'X-Frame-Options', value: 'DENY' },

          // Impede o navegador de "adivinhar" o tipo de um arquivo servido pela aplicacao.
          // Sem isto, um anexo de texto com markup dentro pode ser interpretado como HTML.
          { key: 'X-Content-Type-Options', value: 'nosniff' },

          // Nao vaza a URL interna (que carrega ids de servidor, unidade e competencia) para
          // sites externos - ex.: ao clicar num link de um relatorio.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          // Nada aqui usa camera, microfone ou geolocalizacao... exceto o registro de chegada
          // do sobreaviso, que confere GPS. Por isso `geolocation=(self)`, e nao vazio.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },

          // ⚠️ CSP em REPORT-ONLY DE PROPOSITO. Em modo bloqueio ela quebraria hoje:
          //
          //   1. os 5 relatorios abrem `window.open('')` e escrevem HTML que carrega o Tailwind
          //      de `cdn.tailwindcss.com`; `about:blank` HERDA a CSP de quem abriu;
          //   2. o Tailwind por CDN gera CSS em tempo de execucao, o que exige
          //      'unsafe-inline' em style-src;
          //   3. o Next injeta script inline de hidratacao, e o layout raiz publica
          //      `window.__SISESCALA_TZ__` num <script> inline;
          //   4. o terminal de ponto fica aberto POR DIAS numa tela de portaria e nao recarrega
          //      sozinho - uma CSP que quebre a pagina la nao aparece para ninguem ate alguem
          //      ir ate o equipamento.
          //
          // Report-Only aplica a politica e RELATA o que teria bloqueado, sem bloquear nada.
          // O caminho para endurecer: rodar assim ate ter uma leitura dos relatos, tirar o
          // 'unsafe-inline' de script-src com nonce, e so entao trocar o nome do cabecalho para
          // `Content-Security-Policy`. NAO troque antes de ler os relatos.
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              // 'unsafe-eval' fica de fora: nada no projeto usa eval/new Function (conferido).
              "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              // data: e blob: cobrem o logo do cabecalho e as previas de documento.
              "img-src 'self' data: blob: https:",
              // Supabase (REST, Auth e Realtime por websocket).
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",   // mesmo efeito do X-Frame-Options, para navegador moderno
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
