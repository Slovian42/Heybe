<!-- Heybe: assistente de IA pessoal de código aberto para Mac / agente de IA local -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe: assistente de IA pessoal de código aberto que roda no seu Mac" width="760"></a>
</p>

<h1 align="center">Heybe: assistente de IA pessoal de código aberto para Mac</h1>

<p align="center"><b>Fale uma vez. O Heybe cuida do resto.</b><br>
Um agente de IA local que roda no seu próprio computador, trabalha dentro de um sandbox e pergunta antes de agir.<br>
Use o DeepSeek por padrão ou traga sua própria chave de API da OpenAI ou do Claude.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <b>Português (Brasil)</b> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **Status: a prévia para desenvolvedores está em desenvolvimento. Ainda não há download.** As capturas de tela são prévias de design com dados de exemplo.
> Entre na lista de espera em **[heybe.dev](https://heybe.dev)** ou teste o [protótipo clicável](https://heybe.dev/demo).

## O que é o Heybe?

O Heybe é um **assistente de IA privado que roda no seu computador**. Você pede algo com suas palavras, como pediria a um amigo. Ele planeja as etapas, pesquisa na web, escreve o relatório ou rascunho e salva o resultado como arquivo no seu Mac. Ele continua trabalhando mesmo depois que você fecha a janela.

Feito para quem nunca usou um "agente de IA" e para empreendedores solo e desenvolvedores que querem um **assistente de IA auto-hospedado** que possam inspecionar e modificar:

- **Roda no seu Mac.** Arquivos, tarefas e histórico ficam na sua máquina.
- **Espaço seguro.** Toda ação roda por padrão em um sandbox isolado, longe dos seus arquivos pessoais.
- **Pergunta antes de agir.** Apagar arquivos, gravar fora da pasta dele ou estourar o orçamento exige o seu clique. Digitar "sim" no chat não vale.
- **Você escolhe a IA.** DeepSeek por padrão; sua própria chave da OpenAI ou da Anthropic Claude; ou um modelo local com Ollama para conversar offline.
- **Código aberto.** A edição Community é Apache-2.0 e não exige conta conosco.

## Capturas de tela (prévia de design)

> Mockups da v1 com conteúdo de exemplo; o app real pode ser diferente.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Telas do app Heybe para desktop: boas-vindas, chat, progresso da tarefa, aprovação de ações, relatório e configurações" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Boas-vindas do Heybe: escolha DeepSeek, sua chave de API da OpenAI ou do Claude, ou um modelo local no Mac" width="420"><br>**1. Primeiro uso:** escolha de onde vem a IA. | <img src="docs/images/heybe-chat-plan.png" alt="Chat do Heybe: o assistente de IA local transforma uma frase em um plano passo a passo" width="420"><br>**2. Chat:** fale uma vez e receba um plano. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Progresso no Heybe: cada etapa roda em sandbox, com botão de parar e custo até agora" width="420"><br>**3. Tarefa em andamento:** etapas ao vivo, espaço seguro, botão Parar e custo. | <img src="docs/images/heybe-action-approval.png" alt="Aprovação no Heybe: o agente de IA pergunta antes de apagar arquivos, com Negar, Editar e Aprovar" width="420"><br>**4. Aprovação:** ações sensíveis esperam o seu clique. |
| <img src="docs/images/heybe-task-result-report.png" alt="Resultado no Heybe: tabela comparativa e recomendação com fontes, salva como arquivo local" width="420"><br>**5. Resultado:** relatório com fontes salvo na sua pasta. | <img src="docs/images/heybe-settings-api-keys.png" alt="Configurações do Heybe: provedores de IA e chaves de API, sandbox sempre ligado, Telegram em breve" width="420"><br>**6. Configurações:** IA e chaves, regras de segurança, apps de chat (em breve). |

## O que o Heybe pode fazer?

| Você diz | O Heybe faz |
|---|---|
| "Compare estes cinco apps de notas para mim." | Visita cada site e monta uma tabela com fontes e uma recomendação. |
| "Transforme estas notas de reunião em um resumo semanal." | Extrai decisões, tarefas e responsáveis em um rascunho. |
| "Resuma este artigo e os três links dele." | Lê as páginas e escreve um resumo com links. |
| "Organize minha pasta de rascunhos." | Encontra cópias antigas e pergunta antes de mandar para o Lixo. |
| "Faça um resumo das métricas do meu site desta semana." *(empreendedores solo)* | Um resumo curto e ideias para a próxima semana. |

Mais em [docs/use-cases.md](docs/use-cases.md) (em inglês). Depois da primeira prévia: resumo matinal agendado, alertas de preço e conversar com o Heybe pelo **Telegram** e outros apps de mensagem.

## Recursos e status

| Recurso | Status |
|---|---|
| App para macOS (Tauri + React), somente Apple Silicon (M1 ou posterior) | Em desenvolvimento |
| Chat em streaming com DeepSeek (padrão), OpenAI e Claude (sua chave) | Em desenvolvimento |
| Modelos locais com Ollama (só chat, offline) | Em desenvolvimento |
| Pesquisa web lendo as páginas diretamente, com fontes | Em desenvolvimento |
| Tarefas longas que continuam após fechar a janela (gerenciador local, SQLite) | Base integrada |
| Sandbox por padrão: uma micro-VM por sessão (BoxLite; alternativa Lima) | Prova de conceito |
| Aprovação por clique, custo e modelo visíveis em cada tarefa | Em desenvolvimento |
| DMG assinado e notarizado em heybe.dev, somente Apple Silicon (sem versão Intel, sem Mac App Store) | Planejado |
| Memória de longo prazo que você vê, edita e apaga | v1.1 |
| Telegram e outros apps de chat | Planejado |
| Equipes de agentes dinâmicas | Heybe Pro (depois) |

## Comparação com produtos semelhantes

Resumo de boa-fé com base em informações públicas de outubro de 2026. Os produtos mudam rápido; confira a documentação oficial de cada um.

| | Onde roda | Código | Modelos | Segurança | Apps de chat |
|---|---|---|---|---|---|
| **Heybe** (em desenvolvimento) | Seu Mac | Aberto (Apache-2.0); Pro depois | DeepSeek, OpenAI, Claude (sua chave), Ollama | Sandbox por padrão + aprovação por clique | Telegram planejado |
| [ChatGPT](https://chatgpt.com) (Work / navegador na nuvem) | Nuvem da OpenAI; apps desktop e mobile | Proprietário | OpenAI | Pede permissão para sites novos e ações importantes | — |
| [Claude](https://claude.com) desktop (Cowork) | App desktop (macOS, Windows); código roda em VM local; também sessões na nuvem | Proprietário | Claude | Só pastas autorizadas; confirma ações sensíveis | — |
| [Manus](https://manus.im) | Agente na nuvem; app desktop trabalha em pastas aprovadas | Proprietário | Gerenciados pela Manus | Aprovação de cada comando local | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | Seu computador ou servidor (macOS, Windows, Linux) | Aberto (MIT) | Na nuvem ou locais | Sandbox opcional (ex.: Docker) | Mais de 20 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | Runtime multiagente auto-hospedado | Código disponível (FastClaw Community License) | Na nuvem ou locais | Vários backends de sandbox | Vários |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | Seu terminal | Aberto (Apache-2.0) | Na nuvem ou locais | Pergunta antes de rodar código | — |
| [Jan](https://jan.ai) | App desktop | Aberto (Apache-2.0) | Locais (llama.cpp) e APIs na nuvem | Foco em chat; ferramentas com aprovação | — |
| [LM Studio](https://lmstudio.ai) | App desktop | Proprietário, grátis para uso pessoal e profissional | Modelos locais | Foco em chat | — |

**Por que o Heybe?** Se você procura uma **alternativa ao Manus** ou ao **ChatGPT agent** que rode no seu Mac, seja de código aberto, aceite sua própria chave de API e coloque um sandbox e um clique de aprovação entre a IA e seus arquivos.
**Por que ainda não?** O Heybe ainda não foi lançado; as ferramentas acima já são maduras.

O Heybe roda sobre a API `/v1` do FastClaw, que não faz parte deste repositório (veja [NOTICE](NOTICE)). Todas as marcas pertencem aos seus donos; o Heybe não é afiliado nem endossado por eles.

## Privacidade e segurança

Estas são as regras de design da v1; cada uma será testada antes da prévia.

- **Local por padrão.** Tarefas, arquivos e histórico ficam no seu Mac. Os prompts vão só para o provedor de IA que você escolher, ou para lugar nenhum com um modelo local.
- **Suas chaves são suas.** Ficam nas Chaves do macOS, nunca no repositório, nos logs ou em exportações.
- **Sandbox sempre ligado.** A v1 não tem modo para desligá-lo.
- **Aprovação por clique, não por texto.** Você vê o que vai acontecer e se dá para desfazer; nada acontece até você clicar.
- **Resultados honestos.** Falha aparece como falha, nunca como concluído.

## Roadmap

| Etapa | O quê | Status |
|---|---|---|
| 0 | Repositório, adaptador `/v1` do FastClaw, prova do sandbox | Em andamento |
| 1 | Chat desktop, provedores e chaves, leitura web, tarefas | Em andamento |
| Prévia v1 | Compilar a partir do código no macOS (Apple Silicon) | Ainda não disponível |
| v1.1 | Memória de longo prazo | Planejado |
| Depois | Telegram e apps de chat, tarefas agendadas, equipes de agentes, DMG assinado | Planejado |

## Início rápido para desenvolvedores

Hoje funciona o workspace TypeScript (adaptador, gerenciador de tarefas, interface provisória) e seus testes. Ainda não há um app completo.

```bash
# Requer Node 20+ e pnpm 10 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + verificação de limites + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # interface provisória em http://localhost:1420
```

FastClaw e sandbox: [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md). Nunca coloque chaves reais em arquivos (`.env` é ignorado pelo git).

## Perguntas frequentes

<details><summary><b>Existe um assistente de IA de código aberto que roda localmente no Mac?</b></summary>
O Heybe está sendo construído para isso: Apache-2.0, no seu Mac e com sandbox por padrão. Está em desenvolvimento e ainda não pode ser baixado.</details>

<details><summary><b>O Heybe é uma alternativa gratuita ao Manus?</b></summary>
A edição Community é gratuita e de código aberto, e o trabalho acontece no seu computador. Você paga só o provedor de IA (por exemplo DeepSeek), ou nada com um modelo local.</details>

<details><summary><b>Posso usar minha própria chave de API da OpenAI ou do Claude?</b></summary>
Sim. O DeepSeek é o padrão, e você pode trazer sua chave da OpenAI ou da Anthropic Claude. Ela fica nas Chaves do macOS.</details>

<details><summary><b>Funciona offline com modelos locais?</b></summary>
O chat offline com Ollama está previsto para a v1. O uso de ferramentas com modelos locais não é garantido.</details>

<details><summary><b>Dá para usar pelo Telegram? E no Windows?</b></summary>
Telegram e outros apps de chat chegam depois da primeira prévia. A v1 é só para Mac.</details>

## Community e Pro

| | Heybe Community | Heybe Pro (depois) |
|---|---|---|
| Licença | Apache-2.0, este repositório | Proprietária, Slovian Inc |
| Assistente, tarefas, sandbox, aprovações, sua própria chave | ✓ | ✓ |
| Equipes de agentes montadas sozinhas para cada trabalho | — | ✓ |
| Preço | Grátis | Não anunciado |

## Como contribuir

Contribuições são bem-vindas. Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Todo commit precisa de assinatura DCO (`git commit -s`); a CI confere. Para citar o projeto, veja [CITATION.cff](CITATION.cff).

## Licença

Nosso código usa a [Licença Apache 2.0](LICENSE), Copyright 2026 Slovian Inc. O FastClaw é regido separadamente pela FastClaw Community License; veja [NOTICE](NOTICE). O Heybe não é afiliado a FastClaw, OpenAI, Anthropic, DeepSeek, Manus ou xAI.
