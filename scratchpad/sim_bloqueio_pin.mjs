// Equivalencia da maquina de estados do bloqueio de PIN: logica ANTIGA (TypeScript, em
// validatePin) x logica NOVA (plpgsql, em fn_validar_pin_portal).
//
// Roda:  node scratchpad/sim_bloqueio_pin.mjs
//
// POR QUE ISTO EXISTE
//   A regra "5 erros bloqueiam por 15 minutos" foi movida do TypeScript para o banco. Mover
//   regra e' onde comportamento se perde em silencio — e aqui o que se perde e' alguem sem
//   conseguir entrar no proprio portal, ou pior, um bloqueio que deixa de bloquear.
//   Este simulador roda os dois caminhos sobre os MESMOS estados e exige resultado identico.
//
// ⚠️ Reimplementa as duas logicas em JS. Se qualquer um dos dois lados mudar, mude aqui.

const MAX = 5
const COOLDOWN = 15   // minutos

// ── Logica ANTIGA (copia fiel do validatePin de ate 30/08/2026)
function antiga({ tentativas, minutosDesdeUltima, temPin, pinCerto }) {
  let t = tentativas
  if (minutosDesdeUltima !== null) {
    if (minutosDesdeUltima >= COOLDOWN) {
      t = 0                                   // cooldown expirou: zera e da nova chance
    } else if (t >= MAX) {
      return { r: 'bloqueado', minutos: Math.ceil(COOLDOWN - minutosDesdeUltima) }
    }
  }
  if (!temPin) return { r: 'sem_pin' }
  if (!pinCerto) {
    const novas = (t || 0) + 1
    return { r: 'pin_invalido', restantes: Math.max(MAX - novas, 0) }
  }
  return { r: 'ok' }
}

// ── Logica NOVA (copia fiel do plpgsql de fn_validar_pin_portal)
function nova({ tentativas, minutosDesdeUltima, temPin, pinCerto }) {
  let t = tentativas
  if (minutosDesdeUltima !== null) {
    if (minutosDesdeUltima >= COOLDOWN) {
      t = 0
    } else if (t >= MAX) {
      return { r: 'bloqueado', minutos: Math.ceil(COOLDOWN - minutosDesdeUltima) }
    }
  }
  if (!temPin) return { r: 'sem_pin' }
  if (!pinCerto) {
    // no SQL o UPDATE ... RETURNING devolve o contador ja incrementado
    const novas = t + 1
    return { r: 'pin_invalido', restantes: Math.max(MAX - novas, 0) }
  }
  return { r: 'ok' }
}

// ── Varredura exaustiva do espaco de estados que importa
const estados = []
for (const tentativas of [0, 1, 2, 3, 4, 5, 6, 9]) {
  for (const minutosDesdeUltima of [null, 0, 0.5, 1, 5, 14, 14.9, 15, 15.1, 60, 1440]) {
    for (const temPin of [true, false]) {
      for (const pinCerto of [true, false]) {
        estados.push({ tentativas, minutosDesdeUltima, temPin, pinCerto })
      }
    }
  }
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let divergencias = 0
for (const e of estados) {
  const a = antiga(e), n = nova(e)
  if (!igual(a, n)) {
    divergencias++
    if (divergencias <= 10) {
      console.log(`DIVERGE  ${JSON.stringify(e)}`)
      console.log(`   antiga=${JSON.stringify(a)}  nova=${JSON.stringify(n)}`)
    }
  }
}

console.log(`estados testados: ${estados.length}`)
console.log(`divergencias: ${divergencias}`)

// ── Propriedades que precisam valer na logica NOVA, independentemente da antiga
const props = []
const prop = (nome, ok) => props.push({ nome, ok })

prop('5 erros dentro da janela bloqueiam',
  nova({ tentativas: 5, minutosDesdeUltima: 1, temPin: true, pinCerto: true }).r === 'bloqueado')

prop('bloqueio vale MESMO com o PIN certo (nao vaza que acertou)',
  nova({ tentativas: 5, minutosDesdeUltima: 1, temPin: true, pinCerto: true }).r === 'bloqueado')

prop('passados 15 min, volta a aceitar',
  nova({ tentativas: 9, minutosDesdeUltima: 15, temPin: true, pinCerto: true }).r === 'ok')

prop('primeiro erro deixa 4 tentativas',
  nova({ tentativas: 0, minutosDesdeUltima: null, temPin: true, pinCerto: false }).restantes === 4)

prop('quinto erro deixa 0 tentativas',
  nova({ tentativas: 4, minutosDesdeUltima: 1, temPin: true, pinCerto: false }).restantes === 0)

prop('nunca devolve numero negativo de tentativas',
  estados.filter(e => !e.pinCerto && e.temPin)
         .every(e => (nova(e).restantes ?? 0) >= 0))

prop('sem PIN cadastrado nao conta como erro',
  nova({ tentativas: 0, minutosDesdeUltima: null, temPin: false, pinCerto: false }).r === 'sem_pin')

let falhas = 0
console.log('')
for (const p of props) {
  console.log(`  ${p.ok ? 'ok   ' : 'FALHA'}  ${p.nome}`)
  if (!p.ok) falhas++
}

console.log('')
if (divergencias || falhas) {
  console.error(`REPROVADO: ${divergencias} divergencia(s), ${falhas} propriedade(s) violada(s)`)
  process.exit(1)
}
console.log('APROVADO: a regra de bloqueio no banco e identica a que estava no TypeScript.')
