# Item 15: as duas rotas de maquina passam a usar a fonte unica src/utils/segredoCron.ts.
# Substituicao por REGEX (nao por texto exato): os dois arquivos tem espaco em branco final
# diferente na linha em branco do meio, e casar literalmente falha num deles.
import io, re, sys

NOVO = """    // Fonte unica: src/utils/segredoCron.ts. O segredo deixou de ser aceito por QUERY STRING em
    // 30/08/2026 (achado 15) - `?secret=` vaza para log de proxy, historico de terminal e
    // Referer -, e a comparacao passou a ser em tempo constante.
    const auth = conferirSegredoCron(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro }, { status: auth.status })
    }"""

# do `const { searchParams }` ate o fecha-chaves do `if (providedSecret !== expectedSecret)`
PADRAO = re.compile(
    r"[ \t]*const \{ searchParams \} = new URL\(request\.url\)\r?\n"
    r".*?"
    r"if \(providedSecret !== expectedSecret\) \{\r?\n"
    r"[ \t]*return NextResponse\.json\(\{ error: 'Não autorizado' \}, \{ status: 401 \}\)\r?\n"
    r"[ \t]*\}",
    re.S)

ALVOS = [
    'src/app/api/cron/route.ts',
    'src/app/api/avisos-ponto/despachar/route.ts',
]

for caminho in ALVOS:
    s = io.open(caminho, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in s else '\n'

    if 'conferirSegredoCron' in s:
        print('  (ja transformado) %s' % caminho)
        continue

    achados = PADRAO.findall(s)
    if len(achados) != 1:
        print('ABORTADO: %d ocorrencias do bloco de segredo em %s' % (len(achados), caminho))
        sys.exit(1)

    # ⚠️ `searchParams` continua sendo usado adiante em despachar/route.ts (o parametro `limite`).
    # Por isso a declaracao dele e' REPOSTA quando o resto do arquivo ainda a usa - remover cegamente
    # produziria "searchParams is not defined" so em tempo de execucao, na rota do cron.
    resto = PADRAO.sub('', s)
    precisa_searchparams = 'searchParams' in resto

    novo_bloco = NOVO.replace('\n', eol)
    if precisa_searchparams:
        novo_bloco = ('    const { searchParams } = new URL(request.url)' + eol + eol) + novo_bloco

    s = PADRAO.sub(lambda _m: novo_bloco, s, count=1)

    marca = "import { NextResponse } from 'next/server'"
    if marca not in s:
        print('ABORTADO: import de NextResponse nao encontrado em %s' % caminho)
        sys.exit(1)
    s = s.replace(marca, marca + eol + "import { conferirSegredoCron } from '@/utils/segredoCron'", 1)

    io.open(caminho, 'w', encoding='utf-8', newline='').write(s)
    print('  OK: %s%s' % (caminho, '   (searchParams preservado)' if precisa_searchparams else ''))

# terceira rota citada no achado: o webhook usa outro segredo, confirmar que nao ficou de fora
w = io.open('src/app/api/avisos-ponto/webhook/route.ts', encoding='utf-8', newline='').read()
print('')
print('  webhook/route.ts: %s' % ('usa CRON_SECRET tambem' if 'CRON_SECRET' in w else 'NAO usa CRON_SECRET - conferir a parte'))
