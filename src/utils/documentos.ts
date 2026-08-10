/**
 * Validação de documentos — fonte única em TypeScript.
 *
 * POR QUE ISTO EXISTE
 *   Até 09/08/2026 o sistema tinha **máscara** de digitação (formatava `000.000.000-00` enquanto
 *   se digita) e **nenhuma validação de dígito** — nem no cliente, nem na server action, nem no
 *   banco. O resultado, medido em produção: 4 CPFs gravados com dígito verificador inválido, entre
 *   126 preenchidos. Máscara faz o dado *parecer* certo; ela não confere nada.
 *
 * O ALGORITMO EXISTE EM DOIS LUGARES, E ISSO É INEVITÁVEL
 *   Aqui (cliente e server action) e em SQL (o `CHECK` do banco, que é a única camada que
 *   sobrevive a um INSERT feito fora da aplicação). Duas implementações são necessárias; o que
 *   **não** pode existir é uma terceira, nem divergência entre estas duas.
 *
 *   `scratchpad/confere_documentos.js` roda as duas sobre os documentos reais de produção e
 *   **aborta se discordarem em qualquer um**. Ao mexer em qualquer algoritmo daqui, rode-o.
 */

/** Só os dígitos. `null` quando não sobra nada — formulário devolve string vazia onde o banco tem NULL. */
export function normalizarDoc(valor?: string | null): string | null {
  const d = (valor || '').replace(/\D/g, '')
  return d || null
}

/**
 * Sequência de um dígito só (`00000000000`, `11111111111`) passa na conta dos verificadores mas
 * não é documento. Precisa ser barrada explicitamente — é o erro clássico de quem implementa isto
 * pela primeira vez.
 */
const repetido = (v: string) => new RegExp(`^(\\d)\\1{${v.length - 1}}$`).test(v)

/** CPF: 11 dígitos, dois verificadores por soma ponderada decrescente, módulo 11. */
export function validarCpf(valor?: string | null): boolean {
  const v = normalizarDoc(valor)
  if (!v || v.length !== 11 || repetido(v)) return false

  const digito = (ate: number, pesoInicial: number) => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(v[i]) * (pesoInicial - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }

  return digito(9, 10) === Number(v[9]) && digito(10, 11) === Number(v[10])
}

/** CNPJ: 14 dígitos, pesos cíclicos de 2 a 9, módulo 11 com resto < 2 valendo zero. */
export function validarCnpj(valor?: string | null): boolean {
  const v = normalizarDoc(valor)
  if (!v || v.length !== 14 || repetido(v)) return false

  const digito = (pesos: number[]) => {
    let soma = 0
    for (let i = 0; i < pesos.length; i++) soma += Number(v[i]) * pesos[i]
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }

  return digito([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(v[12])
      && digito([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(v[13])
}

/**
 * PIS/PASEP/NIT/NIS: 11 dígitos, um verificador com pesos fixos 3,2,9,8,7,6,5,4,3,2.
 *
 * Está 0% preenchido hoje, e entra na validação **por isso**: o CLAUDE.md registra que auditor
 * fiscal casa por PIS/NIS, e o preenchimento é projeto da Fase 9 do módulo REP. Começar a
 * preencher 183 registros sem conferência repetiria o problema que o CPF acabou de mostrar.
 */
export function validarPis(valor?: string | null): boolean {
  const v = normalizarDoc(valor)
  if (!v || v.length !== 11 || repetido(v)) return false

  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let soma = 0
  for (let i = 0; i < 10; i++) soma += Number(v[i]) * pesos[i]
  const r = 11 - (soma % 11)
  return (r >= 10 ? 0 : r) === Number(v[10])
}

export type TipoDoc = 'cpf' | 'cnpj' | 'pis'

const VALIDADORES: Record<TipoDoc, (v?: string | null) => boolean> = {
  cpf: validarCpf, cnpj: validarCnpj, pis: validarPis,
}

const TAMANHOS: Record<TipoDoc, number> = { cpf: 11, cnpj: 14, pis: 11 }

const ROTULOS: Record<TipoDoc, string> = { cpf: 'CPF', cnpj: 'CNPJ', pis: 'PIS/PASEP' }

/** Quantos dígitos o documento tem. O campo usa isto para saber quando parar de aceitar. */
export function tamanhoDoc(tipo: TipoDoc): number {
  return TAMANHOS[tipo]
}

/**
 * Mensagem para humano, ou `null` quando está válido — ou quando está **vazio**.
 *
 * Campo vazio nunca é erro aqui: nenhum destes documentos é obrigatório hoje (57 servidores estão
 * sem CPF). Tornar obrigatório é outra decisão, e travar a edição de um terço da base por engano
 * seria o efeito colateral.
 */
export function erroDocumento(valor: string | null | undefined, tipo: TipoDoc): string | null {
  const v = normalizarDoc(valor)
  if (!v) return null

  const esperado = TAMANHOS[tipo]
  if (v.length !== esperado) {
    return `${ROTULOS[tipo]} incompleto — são ${esperado} dígitos, foram informados ${v.length}.`
  }
  if (!VALIDADORES[tipo](v)) {
    // Diz o que fazer, não só que está errado: dígito verificador não se conserta adivinhando.
    return `${ROTULOS[tipo]} inválido — confira os dígitos no documento.`
  }
  return null
}

/** Máscara de exibição. Entrada parcial é formatada até onde dá, para não atrapalhar quem digita. */
export function formatarDoc(valor: string | null | undefined, tipo: TipoDoc): string {
  const v = (valor || '').replace(/\D/g, '').slice(0, TAMANHOS[tipo])
  if (!v) return ''

  if (tipo === 'cnpj') {
    return v
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }
  if (tipo === 'pis') {
    return v
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{5})(\d)/, '$1.$2.$3')
      .replace(/(\d{2})(\d)$/, '$1-$2')
  }
  return v
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}
