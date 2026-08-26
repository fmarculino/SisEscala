package main

import (
	"fmt"
	"os"

	"github.com/sms-maraba/sisescala-coletor-rep/ciclo"
	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
)

// Identidade do descartavel, a MESMA de cadastros-testar/remocao-testar. Reusar o mesmo usuario
// (em vez de inventar outro) e' o que mantem uma unica coisa para apagar do equipamento depois
// de qualquer teste.
const (
	testeMatricula   = "900000"
	testeNome        = "SISESCALA TESTE - PODE APAGAR"
	testeIdentAfd    = "011144477735"
	testeIdentNoAfd  = "011144477735"
	testeAvisoApagar = "Apague o usuario de teste pela interface dos dois equipamentos ao terminar."
)

// rodarBiometriaTestar exercita a COPIA de digital entre dois relogios usando so' o usuario
// descartavel — o `cadastros-testar` da biometria.
//
// Por que existe: gravar template pela API nunca foi confirmado contra hardware (ver
// rep.formatosTemplate). Descobrir o formato em cima do cadastro de um servidor real teria como
// sintoma "a digital dele parou de funcionar", com a pessoa na frente do relogio. Aqui, o pior
// caso e' um usuario de teste com digital estranha, que se apaga.
//
// ⚠️ A digital usada e' a de um DEDO CADASTRADO NO PROPRIO USUARIO DE TESTE, de proposito.
// Copiar o template de um servidor real para o usuario de teste seria pior que inutil: aquele
// dedo passaria a abrir um cadastro que nao e o dele.
func rodarBiometriaTestar(cfg *config.Config, origem, destino *config.DispositivoRepConfig) {
	if origem.ID == destino.ID {
		fmt.Fprintln(os.Stderr, "--de e --para precisam ser relogios diferentes.")
		os.Exit(1)
	}

	fmt.Printf("Teste de copia de biometria\n  de:   %s (%s)\n  para: %s (%s)\n\n",
		origem.Rotulo(), origem.Endereco, destino.Rotulo(), destino.Endereco)
	fmt.Println("ATENCAO: isto GRAVA no relogio de destino - somente no usuario de teste.")
	fmt.Println(testeAvisoApagar)
	fmt.Println()

	rcOrigem := rep.NovoClient(origem.Endereco, origem.Porta, origem.UsaHTTPS,
		origem.UsuarioRep, origem.SenhaRep, origem.CertFingerprint)
	rcDestino := rep.NovoClient(destino.Endereco, destino.Porta, destino.UsaHTTPS,
		destino.UsuarioRep, destino.SenhaRep, destino.CertFingerprint)

	// 1. O usuario de teste precisa existir NA ORIGEM, com um dedo cadastrado.
	naOrigem, achou := acharNoRelogio(rcOrigem, testeIdentAfd, origem.Rotulo())
	if !achou {
		fmt.Printf("O usuario de teste nao existe em %s.\n\n", origem.Rotulo())
		fmt.Printf("Passo a passo:\n"+
			"  1. rode:  coletor-rep-cli cadastros-testar --dispositivo %s\n"+
			"  2. no proprio equipamento, cadastre UM DEDO SEU nesse usuario de teste\n"+
			"     (matricula %s, \"%s\")\n"+
			"  3. rode este comando de novo\n", origem.Rotulo(), testeMatricula, testeNome)
		os.Exit(1)
	}
	if len(naOrigem.Templates) == 0 {
		fmt.Printf("O usuario de teste existe em %s, mas SEM digital cadastrada.\n\n", origem.Rotulo())
		fmt.Printf("Va ate o equipamento e cadastre um dedo seu no usuario \"%s\" (matricula %s),\n"+
			"depois rode este comando de novo.\n", testeNome, testeMatricula)
		os.Exit(1)
	}
	fmt.Printf("origem: usuario de teste encontrado com %d template(s)\n", len(naOrigem.Templates))

	// 2. E precisa existir NO DESTINO (sem digital) — a copia nunca cria usuario.
	noDestino, achou := acharNoRelogio(rcDestino, testeIdentAfd, destino.Rotulo())
	if !achou {
		fmt.Printf("\nO usuario de teste ainda nao existe em %s; criando...\n", destino.Rotulo())
		if _, err := rcDestino.CriarUsuario(testeMatricula, testeNome, testeIdentNoAfd); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao criar o usuario de teste no destino: %v\n", err)
			os.Exit(1)
		}
		noDestino, achou = acharNoRelogio(rcDestino, testeIdentAfd, destino.Rotulo())
		if !achou {
			fmt.Fprintf(os.Stderr, "O destino aceitou a criacao mas o usuario nao aparece na relistagem - "+
				"pare e confira na interface do equipamento.\n")
			os.Exit(1)
		}
		fmt.Println("destino: usuario de teste criado")
	}
	if noDestino.TemBiometria {
		fmt.Printf("\nO usuario de teste em %s JA tem digital - o teste ficaria inconclusivo\n"+
			"(nao daria para saber se a copia funcionou ou se a digital ja estava la).\n"+
			"Apague o usuario de teste no destino pela interface do equipamento e rode de novo.\n",
			destino.Rotulo())
		os.Exit(1)
	}

	// 3. A copia de verdade, com a varredura de formatos e a confirmacao por relistagem.
	fmt.Printf("\ngravando %d template(s) em %s...\n", len(naOrigem.Templates), destino.Rotulo())
	formato, err := rcDestino.GravarTemplates(noDestino, naOrigem.Templates)
	if err != nil {
		fmt.Printf("\nRESULTADO: FALHOU\n  %v\n\n", err)
		fmt.Println("A mensagem acima e o que decide o proximo passo: se todos os formatos foram")
		fmt.Println("recusados, a resposta crua do equipamento diz qual campo ele esperava.")
		os.Exit(1)
	}

	fmt.Printf("\nRESULTADO: OK\n")
	fmt.Printf("  formato aceito pelo equipamento: %s\n", formato)
	fmt.Printf("  (a relistagem confirmou que SO o usuario de teste ganhou digital, e que\n")
	fmt.Printf("   nenhum cadastro novo foi criado)\n\n")
	fmt.Printf("CONFIRME NO EQUIPAMENTO: va ate %s e encoste o mesmo dedo. Se ele reconhecer,\n"+
		"a copia funciona neste parque e a sincronizacao automatica pode ser ligada.\n\n", destino.Rotulo())
	fmt.Println(testeAvisoApagar)
	fmt.Printf("Reporte o formato aceito (%q) para ele ser fixado no codigo.\n", formato)
}

// acharNoRelogio lista o cadastro do equipamento e devolve um usuario pelo identificador_afd.
func acharNoRelogio(rc *rep.Client, identificador, rotulo string) (rep.UsuarioDispositivo, bool) {
	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao ler o cadastro de %s: %v\n", rotulo, err)
		os.Exit(1)
	}
	for _, u := range usuarios {
		if u.IdentificadorAFD == identificador {
			return u, true
		}
	}
	return rep.UsuarioDispositivo{}, false
}

// rodarBiometriaSincronizar aplica a copia de verdade — nos relogios de destino escolhidos.
func rodarBiometriaSincronizar(cfg *config.Config) {
	resultado, err := comTodosResultado(cfg,
		func(d *config.DispositivoRepConfig) (ciclo.ResultadoBiometria, error) {
			return ciclo.SincronizarBiometria(cfg, d, 0)
		},
		func() (ciclo.ResultadoBiometria, error) { return ciclo.SincronizarBiometriaTodos(cfg, 0) })
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao sincronizar biometria: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("pendentes=%d copiados=%d falhas=%d sem_origem_nesta_maquina=%d\n",
		resultado.Pendentes, resultado.Copiados, resultado.Falhas, resultado.SemOrigemLocal)
	if resultado.SemOrigemLocal > 0 {
		fmt.Println("\n(sem_origem_nesta_maquina = a digital existe em um relogio da unidade que ESTE")
		fmt.Println(" computador nao atende. Rode o comando na maquina que enxerga aquele relogio,")
		fmt.Println(" ou traga os dois para o mesmo config.yaml.)")
	}
}
