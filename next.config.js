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
};

module.exports = nextConfig;
