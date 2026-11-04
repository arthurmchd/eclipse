# ADR-011 Cartões sobre a arte do Riot

Data: 2026-10-28. Status: aceita.

Revisão de encaixe de 2026-11-04: o usuário pediu a barra superior encostada no topo sem ampliar sua largura, e o rodapé até as bordas inferior e direita do Riot. O observador passa a medir a área cliente por `GetClientRect` e `ClientToScreen`, excluindo bordas externas invisíveis do Windows. A janela cobre a área de arte inteira; sua região nativa é a união de dois retângulos: coluna principal com reserva direita e rodapé completo de 104 DIP. `setShape` volta apenas para essa delimitação contínua, sem recortes individuais em volta dos ícones. A mesma reserva direita é aplicada ao cabeçalho e à lista no CSS; o rodapé usa altura fixa de 104 px. Isso mantém os controles nativos acessíveis acima do rodapé. A coluna de login continua fora da sobreposição.

Refinamento de 2026-11-04 após aprovação do alinhamento: removido o véu branco do fundo geral, que passa a ser totalmente transparente. Cartões e rodapé preservam suas superfícies claras. Removidos título, subtítulo e aviso geral de estatísticas. A geometria permanece a mesma da revisão abaixo.

Revisão de 2026-11-04: o usuário pediu transparência e elevação do painel, preservando também a faixa vertical dos controles à direita. O login conserva a divisão 400/1536; a direita reserva 104/1536 da largura, com mínimo de 96 DIP e limite ao espaço disponível. Margens superior e inferior de até 24 DIP substituem a faixa superior de 25%. O fundo usa branco translúcido para mostrar a arte real, mantendo cartões claros legíveis. A reserva direita vale para toda a altura, fora da pintura e dos cliques da sobreposição, sem recortes. Menus nativos que avancem além dessa faixa continuam exigindo verificação ao vivo. Esta é a geometria vigente.

Revisão de 2026-11-02: aprovada a versão clara da prévia, com cartões selecionáveis e uma única ação Jogar no rodapé. O painel oferece League e VALORANT; dados e suporte legado de TFT permanecem no serviço. A sobreposição começa abaixo de uma faixa contínua da arte (25% da altura, limitada entre 112 e 240 DIP), preservando a posição dos controles nativos. Removidos todos os recortes individuais e `setShape`. O topo do painel faz uma transição transparente para o fundo claro. A regra de aparecer somente durante login é mantida. Essa revisão substitui as geometrias e cores históricas abaixo.

O usuário pediu substituir a interface completa por caixas contendo nome, nível, rank, winrate, vitórias e derrotas. O modo sobreposto carrega um renderer compacto transparente, sempre aberto nos 70% direitos da janela. Margens deixam os controles superiores e toda a área esquerda de login livres.

Revisão solicitada pelo usuário: ocupar toda a área da arte com fundo sólido. O limite é a proporção medida no layout do cliente (400 de 1536 pixels para login, aproximadamente 26%); o painel ocupa os 74% restantes, do topo ao rodapé. A barra interna reserva o espaço dos controles. A medida é proporcional ao layout conhecido, não detecção automática por pixels.

Refinamento do acabamento: o recorte inicial de 104×104 DIP foi substituído por três círculos independentes, excluídos da pintura e do hit-test. Perfil mantém raio de 24 DIP; minimizar e fechar usam 12 DIP cada. Assim os espaços entre controles têm o fundo do painel, sem o bloco quadrado de arte. São os controles nativos, sem simular ações ou copiar o menu da Riot.

Cadastro, edição e configurações essenciais ficam em diálogos compactos nessa área. O layout antigo permanece apenas no modo privado. Dados públicos chegam pelo preload e serviço existentes. Progresso e cancelamento ficam nos cartões. Campos sem dados mostram traço, sem estatísticas inventadas. A instalação Riot não é alterada.
