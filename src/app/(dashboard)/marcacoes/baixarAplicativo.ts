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

  const blob = await resposta.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `coletor-rep-${tipo}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
