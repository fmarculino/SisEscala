/**
 * Dispara o download do .zip (app de bandeja + config.yaml já preenchido) pelo navegador.
 * Para tipo 'dispositivo', endereço/usuário/senha/porta do relógio vêm do banco (a rota lê
 * dispositivos_rep pelo id) — nunca do que está no formulário no momento do clique.
 */
export async function baixarAplicativoColetorRep(tipo: 'terminal' | 'dispositivo', id: string, token: string) {
  const resposta = await fetch('/api/coletor-rep/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, id, token }),
  })

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null)
    throw new Error(corpo?.error || 'Falha ao gerar o aplicativo para download.')
  }

  await dispararDownload(resposta, `coletor-rep-${tipo}.zip`)
}

/**
 * Mesma coisa, para a unidade com VÁRIOS relógios atendidos por um computador só: o .zip sai com
 * um config.yaml contendo os N equipamentos (chave `dispositivos_rep`, lida pelo coletor a partir
 * da v0.9.0).
 *
 * Os tokens vêm prontos de `gerarTokensUnidadeRep` — a rota não gera token nenhum, pelo mesmo
 * motivo do caso de um relógio só: gerar no download invalidaria em silêncio a instalação que já
 * estivesse rodando em campo.
 */
export async function baixarAplicativoUnidadeRep(dispositivos: { id: string; token: string }[]) {
  const resposta = await fetch('/api/coletor-rep/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'unidade', dispositivos }),
  })

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null)
    throw new Error(corpo?.error || 'Falha ao gerar o aplicativo para download.')
  }

  await dispararDownload(resposta, 'coletor-rep-unidade.zip')
}

async function dispararDownload(resposta: Response, nomeArquivo: string) {
  const blob = await resposta.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
