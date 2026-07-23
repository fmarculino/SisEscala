'use client'

interface RequerimentoPrintViewProps {
  solicitacao: any
  servidor: any
  logoUrl?: string | null
}

const MODALIDADE_LABELS: Record<string, string> = {
  integral_30: 'Integral (30 dias corridos)',
  fracionado_15_15: 'Fracionado (15 + 15 dias)',
  abono_10_20: 'Abono Pecuniário (10 dias) + Gozo (20 dias)',
  integral_90: 'Integral (90 dias corridos)',
  fracionado_45_45: 'Fracionado (45 + 45 dias)',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '___/___/______'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function RequerimentoPrintView({ solicitacao, servidor, logoUrl }: RequerimentoPrintViewProps) {
  const tipoLabel = solicitacao.tipo_beneficio === 'ferias' ? 'FÉRIAS' : 'LICENÇA PRÊMIO'
  const unidadeNome = (servidor.unidades as any)?.nome || 'Hospital Municipal de Marabá'
  const setorNome = (servidor.setores as any)?.dicionario_setores?.nome || '—'

  const endereco = [
    servidor.endereco_logradouro,
    servidor.endereco_numero ? `Nº ${servidor.endereco_numero}` : null,
    servidor.bairro,
    servidor.municipio_residencia,
    servidor.cep ? `CEP: ${servidor.cep}` : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="print-only bg-white text-black p-8 max-w-[210mm] mx-auto text-sm leading-relaxed" style={{ fontFamily: 'Times New Roman, serif' }}>
      {/* Header */}
      <div className="text-center mb-6">
        {logoUrl && (
          <div className="flex justify-center mb-2">
            <img src={logoUrl} alt="Logo" className="h-16 object-contain" />
          </div>
        )}
        <p className="text-xs uppercase tracking-wider font-bold">Prefeitura Municipal de Marabá</p>
        <p className="text-xs uppercase tracking-wider">Secretaria Municipal de Saúde</p>
        <p className="text-xs uppercase tracking-wider">{unidadeNome}</p>
        <div className="mt-3 border-b-2 border-black" />
      </div>

      {/* Title */}
      <h1 className="text-center text-base font-bold uppercase mb-6 tracking-wide">
        Requerimento de {tipoLabel}
      </h1>

      {/* Body Text */}
      <div className="space-y-4 text-justify">
        <p>
          <strong>Eu, {servidor.nome}</strong>, matrícula nº <strong>{servidor.matricula || '________'}</strong>, 
          portador(a) do RG nº <strong>{servidor.rg_numero || '________'}</strong>
          {servidor.rg_orgao_emissor ? ` — ${servidor.rg_orgao_emissor}` : ''}, 
          CPF nº <strong>{servidor.cpf || '___.___.___-__'}</strong>, 
          vínculo <strong>{servidor.vinculo || '________'}</strong>, 
          exercendo o cargo de <strong>{servidor.cargo || '________'}</strong>, 
          lotado(a) no(a) <strong>{unidadeNome}</strong> — Setor <strong>{setorNome}</strong>, 
          residente e domiciliado(a) em <strong>{endereco || '________________________________________'}</strong>, 
          venho, respeitosamente, requerer a concessão de <strong>{tipoLabel}</strong> referente ao exercício/quinquênio <strong>{solicitacao.exercicio}</strong>, 
          na modalidade <strong>{MODALIDADE_LABELS[solicitacao.modalidade] || solicitacao.modalidade}</strong>, 
          conforme períodos abaixo especificados:
        </p>

        {/* Periods Table */}
        <table className="w-full border-collapse border border-black mt-4 mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black px-3 py-2 text-left font-bold">Período</th>
              <th className="border border-black px-3 py-2 text-center font-bold">Data Início</th>
              <th className="border border-black px-3 py-2 text-center font-bold">Data Fim</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-3 py-2">1º Período</td>
              <td className="border border-black px-3 py-2 text-center font-semibold">
                {formatDate(solicitacao.periodo_deferido_p1_inicio)}
              </td>
              <td className="border border-black px-3 py-2 text-center font-semibold">
                {formatDate(solicitacao.periodo_deferido_p1_fim)}
              </td>
            </tr>
            {solicitacao.periodo_deferido_p2_inicio && (
              <tr>
                <td className="border border-black px-3 py-2">2º Período</td>
                <td className="border border-black px-3 py-2 text-center font-semibold">
                  {formatDate(solicitacao.periodo_deferido_p2_inicio)}
                </td>
                <td className="border border-black px-3 py-2 text-center font-semibold">
                  {formatDate(solicitacao.periodo_deferido_p2_fim)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Abono Pecuniário note */}
        {solicitacao.abono_pecuniario && (
          <p className="italic">
            <strong>Nota:</strong> Opto pela conversão de 10 (dez) dias de férias em abono pecuniário, conforme legislação vigente.
          </p>
        )}

        {/* Adicional de 1/3 */}
        {solicitacao.adicional_terco && (
          <p>
            Solicito, ainda, o pagamento do <strong>adicional constitucional de 1/3 (um terço) de férias</strong>, conforme 
            previsto no art. 7º, inciso XVII, da Constituição Federal.
          </p>
        )}

        <p className="mt-4">
          Nestes termos, pede deferimento.
        </p>
      </div>

      {/* Date and Signatures */}
      <div className="mt-10 space-y-12">
        <p className="text-center">
          Marabá - PA, _______ de __________________________ de ________
        </p>

        <div className="flex justify-between mt-16 px-8">
          <div className="text-center">
            <div className="border-t border-black w-56 mx-auto" />
            <p className="mt-1 text-xs">Assinatura do(a) Servidor(a)</p>
            <p className="text-xs text-gray-600">Mat.: {servidor.matricula || '________'}</p>
          </div>

          <div className="text-center">
            <div className="border-t border-black w-56 mx-auto" />
            <p className="mt-1 text-xs">Assinatura/Carimbo da Chefia Imediata</p>
          </div>
        </div>
      </div>

      {/* Parecer Section */}
      <div className="mt-12 border-t-2 border-black pt-4">
        <h2 className="font-bold uppercase text-sm mb-2">Parecer da Chefia Imediata / Coordenação</h2>
        <div className="border border-black min-h-[60px] p-2 mb-4">
          <p>{solicitacao.parecer_coordenador || ''}</p>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <label className="flex items-center gap-1">
            <span className={`inline-block w-4 h-4 border border-black ${solicitacao.status === 'deferido' ? 'bg-black' : ''}`} />
            DEFERIDO
          </label>
          <label className="flex items-center gap-1">
            <span className={`inline-block w-4 h-4 border border-black ${solicitacao.status === 'indeferido' ? 'bg-black' : ''}`} />
            INDEFERIDO
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-gray-500">
        <p>Documento gerado pelo SisEscala em {new Date().toLocaleDateString('pt-BR')}</p>
      </div>

      {/* Print styles */}
      <style jsx>{`
        @media print {
          .print-only {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 9999;
            background: white;
          }
        }
      `}</style>
    </div>
  )
}
