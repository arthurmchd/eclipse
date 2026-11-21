---
tipo: decisão
status: aceita
data: 2026-11-21
tags: [adr, arquitetura, desempenho, segurança]
---

# ADR-044 Helpers do Windows em Rust

## Contexto

Três scripts PowerShell com C# embutido faziam o trabalho com janelas: [[loginForm]] (preencher o formulário), [[windowGuard]] (trazer a Riot à frente, fechá-la e procurar a janela do jogo) e [[riotWindowObserver]] (acompanhar a janela da Riot). Cada chamada de `login.ps1` e `windowGuard.ps1` abria um `powershell.exe` e compilava o C# na hora.

- **Tempo.** Abrir o PowerShell e compilar leva de 1 a 2 s. No login com senha isso entra antes do preenchimento. Enquanto espera o jogo, o [[signInFlow]] pergunta pela janela do jogo a cada 500 ms, e cada pergunta abria um PowerShell novo; no teste de 2026-11-21, o Eclipse levou de 1,4 a 4,5 s para notar a janela do League.
- **Antivírus e PCs bloqueados.** `powershell.exe -ExecutionPolicy Bypass` recebendo credenciais pelo stdin é um padrão que antivírus costumam marcar, e algumas empresas bloqueiam scripts PowerShell. Com muitos usuários, isso vira falha de login sem explicação.
- **Testes.** A lógica pura dos scripts só era testada pelo `self-test` rodado pelo Node; o Rust testava apenas o protocolo de texto.

## Decisão

O que os scripts faziam passa para o Rust, no mesmo processo do Eclipse, com as mesmas funções do Windows (`windows-sys`, e o crate `windows` para o UI Automation, que é COM):

- `login_form.rs` substitui o `login.ps1`, com o mesmo comportamento: espera do formulário pelas mesmas leituras de pixel, UI Automation primeiro ([[ADR-043 Preenchimento do login por UI Automation]]), digitação por mensagens como recuo, caixa "Stay signed in" e clique em entrar.
- `window_guard.rs` substitui o `windowGuard.ps1`.
- O observador continua no seu próprio fio de execução, mas em Rust, com o mesmo laço de mensagens, os mesmos ganchos e as mesmas regras de ordem das janelas.
- A troca é por traits (`LoginForm`, `WindowOps`), para os testes continuarem usando versões falsas. A lógica pura vira funções testadas no `cargo test`, e o antigo `self-test` do observador vira teste do Rust com janelas de teste fora da tela.
- As credenciais passam de uma função para outra, sem JSON nem processo intermediário.

## Alternativas consideradas

- **Manter o PowerShell e só deixar um processo aberto:** tiraria o tempo de abertura, mas manteria o padrão que antivírus marcam e a dependência de PowerShell liberado.
- **Um executável auxiliar separado em Rust:** resolve o antivírus, mas mantém um processo e um protocolo de texto a mais sem ganho.
- **Portar só o login:** deixaria o atraso de notar a janela do jogo e o observador ainda em PowerShell.

## Consequências

- O login com senha começa a preencher mais cedo, e o Eclipse nota a janela do jogo em milissegundos.
- O Eclipse deixa de chamar `powershell.exe`.
- Uma falha grave numa chamada do Windows agora pode derrubar o Eclipse, não só um script. Por isso as chamadas ficam em funções pequenas, que conferem cada retorno e liberam handles e objetos GDI sempre.
- O UI Automation precisa do COM inicializado. O preenchimento roda num fio próprio, que inicializa e encerra o COM.
- A ação de preencher continua sem teste automatizado com a Riot real; vale a conferência descrita em [[Publicar no GitHub]].

## Implementação (2026-11-21, 2.19.0)

- `login_form.rs`, `window_guard.rs` e `observer_thread.rs`, mais `win32.rs` com as leituras de processo e janela que os três e o [[riotClient]] usam ([[win32]]). A lista de processos também deixou de abrir o `tasklist`.
- O observador manteve o protocolo de linhas: o `NativeObserver` implementa o mesmo `ObserverSpawn` que o PowerShell implementava, com um canal no lugar do stdin. O `RiotWindowObserver` não mudou, fora o caminho do script que saiu do construtor.
- O autoteste do observador virou `observer_thread::self_test()`, rodado pelo `cargo test` com duas janelas fora da tela, e passa. As regras do login e do helper de janelas viraram testes de funções puras.
- Saíram os três `.ps1`, os dois testes JS que os rodavam, `windows_helpers_dir()`, `observer_script()`, `HelperRunner`, `PowerShell` e os textos de erro que só existiam por causa do processo ("did not respond", "window script failed", "stopped", "timed out"). Um teste confere que o Setup não leva script e que o Rust não abre PowerShell.
- `cargo clippy -- -D warnings`, `cargo test` e `npm test` passam. As leituras de janela que recebem `HWND` ficaram `pub(crate)`, porque o clippy pede `unsafe` em função pública com ponteiro cru.
- Ainda não conferido na Riot real: o preenchimento, o acompanhamento da janela e a detecção do jogo pela versão em Rust.

## Relacionado

- [[loginForm]]
- [[windowGuard]]
- [[riotWindowObserver]]
- [[Segurança e privacidade]]
