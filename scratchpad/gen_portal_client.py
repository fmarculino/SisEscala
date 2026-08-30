# Ajusta as chamadas do CLIENTE do portal as novas assinaturas (identidade vem da sessao).
# Aborta se qualquer trecho nao casar exatamente uma vez.
import io, sys

CLIENT = 'src/app/consultar-escala/ConsultarEscalaClient.tsx'
FERIAS = 'src/app/consultar-escala/PortalFeriasLicencasSection.tsx'

EDITS = [
    # sugerirJustificativaServidor: servidorId e servidorNome sairam do payload
    (CLIENT,
     "    const res = await sugerirJustificativaServidor({\n      servidorId: servidor.id,\n",
     "    const res = await sugerirJustificativaServidor({\n"),
    (CLIENT,
     "      categoria: sugerirModalData.categoria,\n      texto,\n      servidorNome: servidor.nome\n    })",
     "      categoria: sugerirModalData.categoria,\n      texto,\n    })"),

    # tempServidorId deixa de existir. O UUID nunca mais chega ao navegador: o que a tela guarda
    # e' so' "a matricula foi validada" e o nome, para confirmar a pessoa antes do PIN.
    (CLIENT,
     "  const [tempServidorId, setTempServidorId] = useState<string | null>(null)\n",
     ""),
    (CLIENT,
     "      setIsMatriculaValid(false)\n      setTempServidorId(null)\n    } else {\n"
     "      setIsMatriculaValid(true)\n      setTempServidorId(result.servidor.id)\n    }",
     "      setIsMatriculaValid(false)\n    } else {\n"
     "      setIsMatriculaValid(true)\n      setServidorNome(result.servidor.nome || '')\n    }"),
    (CLIENT,
     "    if (!tempServidorId || !pin) return",
     "    if (!isMatriculaValid || !pin) return"),

    # criarSolicitacaoPrevisao: servidorId saiu do payload
    (FERIAS,
     "    const res = await criarSolicitacaoPrevisao({\n      servidorId: servidor.id,\n",
     "    const res = await criarSolicitacaoPrevisao({\n"),
]

# ⚠️ Os arquivos do portal NAO tem a mesma quebra de linha: actions.ts e' LF e os dois
# componentes cliente sao CRLF. Casar com '\n' fixo devolve ZERO ocorrencia num deles e o script
# aborta sem explicar o motivo real. O padrao e' escrito com '\n' e adaptado ao arquivo aqui.
for caminho, antigo, novo in EDITS:
    s = io.open(caminho, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in s else '\n'
    antigo_f = antigo.replace('\n', eol)
    novo_f = novo.replace('\n', eol)
    n = s.count(antigo_f)
    if n != 1:
        print('ABORTADO: %d ocorrencias em %s (eol=%r) de:\n%r' % (n, caminho, eol, antigo[:90]))
        sys.exit(1)
    io.open(caminho, 'w', encoding='utf-8', newline='').write(s.replace(antigo_f, novo_f))

print('OK: %d ajustes aplicados no cliente do portal' % len(EDITS))
