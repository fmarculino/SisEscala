/**
 * Portao de `src/utils/escalasNavegacao.ts` (nao ha framework de teste no projeto).
 *
 * Transpile antes:
 *   npx tsc src/utils/escalasNavegacao.ts src/utils/permissions.ts \
 *     --outDir scratchpad/_sim --module commonjs --target es2020 --skipLibCheck
 *   node scratchpad/sim_escalas_navegacao.js
 */
const nav = require('./_sim/escalasNavegacao')

let falhas = 0
const checar = (nome, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (!ok) {
    falhas++
    console.log(`FALHOU  ${nome}\n  obtido:   ${JSON.stringify(obtido)}\n  esperado: ${JSON.stringify(esperado)}`)
  } else {
    console.log(`ok      ${nome}`)
  }
}

// --- filtros na URL: ida e volta ------------------------------------------------------------
const filtros = {
  busca: 'lacem',
  servidor: '205',
  unidade: 'u1',
  mes: '8',
  ano: '2026',
  status: 'previsao',
  incluirInativas: true
}
const qs = nav.escreverFiltros(filtros)
checar('escreverFiltros -> lerFiltros preserva tudo', nav.lerFiltros(qs), filtros)
checar('lerFiltros aceita a query com "?"', nav.lerFiltros('?' + qs), filtros)

const padrao = nav.filtrosPadrao()
checar('mes/ano vao mesmo quando iguais ao padrao',
  new URLSearchParams(nav.escreverFiltros(padrao)).get('mes'), padrao.mes)
checar('sem filtro, a query so tem periodo',
  nav.escreverFiltros(padrao).split('&').sort(), [`ano=${padrao.ano}`, `mes=${padrao.mes}`].sort())
checar('query vazia devolve o padrao', nav.lerFiltros(''), padrao)

// --- a URL da grade carrega os filtros de origem ---------------------------------------------
const alvo = { unidade_id: 'u1', setor_id: 's1', mes: 8, ano: 2026 }
checar('urlDaGrade sem origem',
  nav.urlDaGrade(alvo, ''), '/escalas/unidade/u1?setor=s1&mes=8&ano=2026')
checar('urlDaGrade com origem codificada',
  nav.urlDaGrade(alvo, 'mes=8&ano=2026'),
  '/escalas/unidade/u1?setor=s1&mes=8&ano=2026&origem=mes%3D8%26ano%3D2026')

// --- agrupamento e ordem ---------------------------------------------------------------------
const linha = (u, s, mes, ano, extra = {}) => ({
  unidade_id: u, setor_id: s, mes, ano, ativo: true, status: 'Rascunho',
  unidades: { nome: u.toUpperCase() }, setores: { nome: s.toUpperCase() }, ...extra
})

const linhas = [
  linha('zeta', 'portaria', 8, 2026),
  linha('alfa', 'zelador', 8, 2026),
  linha('alfa', 'admin', 8, 2026),
  linha('alfa', 'admin', 8, 2026), // mesma escala, outro servidor
  linha('alfa', 'admin', 7, 2026),
  linha('alfa', 'admin', 9, 2026)
]
const grupos = nav.agruparEscalas(linhas)
checar('dedup por (unidade, setor, mes, ano)', grupos.length, 5)
checar('ordem: competencia desc, depois unidade e setor por nome',
  grupos.map(g => `${g.unidade_nome}/${g.setor_nome}/${g.mes}`),
  ['ALFA/ADMIN/9', 'ALFA/ADMIN/8', 'ALFA/ZELADOR/8', 'ZETA/PORTARIA/8', 'ALFA/ADMIN/7'])

checar('a ordem nao depende da ordem de chegada',
  nav.agruparEscalas([...linhas].reverse()).map(g => g.chave),
  grupos.map(g => g.chave))

checar('indiceDaEscala acha a escala aberta',
  nav.indiceDaEscala(grupos, { unidadeId: 'zeta', setorId: 'portaria', mes: 8, ano: 2026 }), 3)
checar('indiceDaEscala devolve -1 fora da lista',
  nav.indiceDaEscala(grupos, { unidadeId: 'zeta', setorId: 'portaria', mes: 1, ano: 2026 }), -1)

// --- visibilidade -----------------------------------------------------------------------------
const superAdmin = { role: 'super_admin' }
const semFiltro = { ...padrao, mes: 'todos', ano: 'todos' }

checar('inativa fica de fora por padrao',
  nav.escalaVisivel(linha('alfa', 'admin', 8, 2026, { ativo: false }), semFiltro, superAdmin, null), false)
checar('inativa aparece com "mostrar inativas"',
  nav.escalaVisivel(linha('alfa', 'admin', 8, 2026, { ativo: false }), { ...semFiltro, incluirInativas: true }, superAdmin, null), true)
checar('status previsao exclui Fechada',
  nav.escalaVisivel(linha('alfa', 'admin', 8, 2026, { status: 'Fechada' }), { ...semFiltro, status: 'previsao' }, superAdmin, null), false)
checar('status fechada exige Fechada',
  nav.escalaVisivel(linha('alfa', 'admin', 8, 2026, { status: 'Fechada' }), { ...semFiltro, status: 'fechada' }, superAdmin, null), true)
checar('busca casa nome de setor',
  nav.escalaVisivel(linha('alfa', 'portaria', 8, 2026), { ...semFiltro, busca: 'porta' }, superAdmin, null), true)
checar('busca que nao casa exclui',
  nav.escalaVisivel(linha('alfa', 'portaria', 8, 2026), { ...semFiltro, busca: 'lacem' }, superAdmin, null), false)
checar('filtro de unidade',
  nav.escalaVisivel(linha('alfa', 'portaria', 8, 2026), { ...semFiltro, unidade: 'beta' }, superAdmin, null), false)

const comServidor = linha('alfa', 'admin', 8, 2026, {
  servidor_id: 'x1',
  servidores: { id: 'x1', nome: 'MARIA DE SOUSA', cpf: '05363893045', matricula: '205' }
})
checar('busca de servidor por nome',
  nav.escalaVisivel(comServidor, { ...semFiltro, servidor: 'maria' }, superAdmin, null), true)
checar('busca de servidor por matricula',
  nav.escalaVisivel(comServidor, { ...semFiltro, servidor: '205' }, superAdmin, null), true)
checar('busca de servidor por CPF formatado',
  nav.escalaVisivel(comServidor, { ...semFiltro, servidor: '053.638.930-45' }, superAdmin, null), true)
checar('servidor que nao casa exclui',
  nav.escalaVisivel(comServidor, { ...semFiltro, servidor: 'joao' }, superAdmin, null), false)

// Papel do Portal so enxerga a propria escala.
checar('servidor ve a escala dele',
  nav.escalaVisivel(comServidor, semFiltro, { role: 'servidor' }, 'x1'), true)
checar('servidor nao ve a escala de outro',
  nav.escalaVisivel(comServidor, semFiltro, { role: 'servidor' }, 'x2'), false)

// Coordenador depende do escopo (hasSectorAccess).
const coordenador = {
  role: 'coordenador',
  acesso_todas_unidades: false,
  acesso_todos_setores: false,
  permitted_unidades: ['alfa'],
  permitted_setores: ['admin']
}
checar('coordenador ve o setor vinculado',
  nav.escalaVisivel(linha('alfa', 'admin', 8, 2026), semFiltro, coordenador, null), true)
checar('coordenador nao ve setor fora do escopo',
  nav.escalaVisivel(linha('alfa', 'portaria', 8, 2026), semFiltro, coordenador, null), false)
checar('RH da unidade nao e barrado pelo predicado (a RLS escopa)',
  nav.escalaVisivel(linha('zeta', 'portaria', 8, 2026), semFiltro, { role: 'rh_unidade' }, null), true)

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
