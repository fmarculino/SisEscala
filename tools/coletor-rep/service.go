package main

import (
	"log"
	"time"

	"github.com/kardianos/service"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
)

type programaServico struct {
	cfg   *config.Config
	parar chan struct{}
}

func (p *programaServico) Start(s service.Service) error {
	p.parar = make(chan struct{})
	go p.rodar()
	return nil
}

func (p *programaServico) Stop(s service.Service) error {
	close(p.parar)
	return nil
}

func (p *programaServico) rodar() {
	executarCiclo := func() {
		if p.cfg.DispositivoRep != nil {
			if err := rodarSync(p.cfg); err != nil {
				log.Printf("erro no sync: %v", err)
			}
			if err := rodarHeartbeat(p.cfg); err != nil {
				log.Printf("erro no heartbeat: %v", err)
			}
		}
	}

	executarCiclo()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			executarCiclo()
		case <-p.parar:
			return
		}
	}
}

func gerenciarServico(comando string, cfg *config.Config) error {
	svcConfig := &service.Config{
		Name:        "SisEscalaColetorRep",
		DisplayName: "SisEscala — Coletor de Ponto",
		Description: "Sincroniza o relogio de ponto REP e mantem o terminal local do SisEscala.",
	}

	prog := &programaServico{cfg: cfg}
	s, err := service.New(prog, svcConfig)
	if err != nil {
		return err
	}

	if comando == "run" {
		return s.Run()
	}
	return service.Control(s, comando)
}
