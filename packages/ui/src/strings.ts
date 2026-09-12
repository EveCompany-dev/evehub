/**
 * Toda string visivel ao usuario mora aqui, em pt-BR.
 *
 * O codigo (identificadores, tabelas, commits) fica em ingles; a interface
 * fica em portugues. Centralizar aqui significa que trocar por next-intl
 * depois e mecanico, sem cacar texto solto em 40 componentes.
 */
export const strings = {
  app: {
    name: 'Eve Hub',
    tagline: 'Central da EveCompany',
  },

  auth: {
    signInTitle: 'Entrar no Eve Hub',
    signInSubtitle: 'Acesso restrito ao time da EveCompany.',
    email: 'E-mail',
    password: 'Senha',
    signIn: 'Entrar',
    signingIn: 'Entrando...',
    signInWithGoogle: 'Entrar com Google',
    signOut: 'Sair',
    or: 'ou',
    invalidCredentials: 'E-mail ou senha incorretos.',
    tooManyAttempts: 'Muitas tentativas. Tente de novo em alguns minutos.',
    domainNotAllowed: 'Esse e-mail nao pertence ao dominio autorizado.',
    genericError: 'Nao foi possivel entrar. Tente de novo.',
    serviceUnavailable: 'Servico indisponivel. Verifique se o banco e o Redis estao rodando (pnpm services:up).',
  },

  dock: {
    addTitle: 'Adicionar modulo',
    searchPlaceholder: 'Buscar modulo...',
    noResults: 'Nenhum modulo encontrado.',
    catalogHint: 'A lista mostra as integracoes ja registradas. Conectar novas contas sera feito na tela de integracoes.',
    lock: 'Travar layout',
    unlock: 'Destravar layout',
    connect: 'Conectar',
    connecting: 'Conectando...',
    back: 'Voltar',
    ownerOnly: 'So um owner pode conectar esta integracao.',
  },

  notion: {
    token: 'Token da integracao',
    tokenHint:
      'Crie em notion.so/my-integrations (Internal Integration Secret). Depois abra a database no Notion e compartilhe com a integracao pelo menu "..." > Conexoes.',
    database: 'URL ou ID da database',
    databaseHint: 'Pode colar a URL da pagina do Notion direto da barra de enderecos.',
    truncated: 'Mostrando as primeiras linhas: essa database e maior que o limite de uma sincronizacao.',
  },

  profile: {
    title: 'Perfil',
    back: 'Voltar para a dashboard',
    name: 'Nome',
    email: 'E-mail',
    picture: 'Foto (URL)',
    picturePlaceholder: 'https://...',
    edit: 'Editar dados',
    save: 'Salvar',
    cancel: 'Cancelar',
    saved: 'Dados atualizados.',
    owner: 'Owner do workspace',
    member: 'Membro',
    passwordTitle: 'Senha',
    passwordHint:
      'Senhas sao guardadas com hash argon2id e nao podem ser exibidas — nem por nos. Da para trocar, nao para consultar.',
    currentPassword: 'Senha atual',
    newPassword: 'Nova senha',
    showPassword: 'Mostrar senha',
    hidePassword: 'Ocultar senha',
    changePassword: 'Trocar senha',
    passwordChanged: 'Senha atualizada.',
    noPasswordYet: 'Esta conta entra so pelo Google. Defina uma senha para poder entrar por e-mail tambem.',
    setPassword: 'Definir senha',
  },

  team: {
    title: 'Equipe',
    hint: 'Quem tem e-mail do dominio autorizado ja entra sozinho pelo Google. Cadastre aqui quem nao tem conta Google da empresa, quem precisa de senha, ou quem ja deve nascer admin.',
    add: 'Adicionar pessoa',
    confirmAdd: 'Criar conta',
    adding: 'Criando...',
    added: 'Conta criada.',
    cancel: 'Cancelar',
    name: 'Nome',
    email: 'E-mail',
    password: 'Senha inicial (opcional)',
    passwordHint: 'Deixe em branco se a pessoa vai entrar so pelo Google. Ela pode trocar depois no proprio perfil.',
    makeOwner: 'Dar acesso de admin (owner)',
    owner: 'admin',
    member: 'membro',
    you: 'voce',
    hasPassword: 'senha definida',
    googleOnly: 'so Google',
    disabled: 'desativado',
    promote: 'Tornar admin',
    demote: 'Remover admin',
    disable: 'Desativar',
    enable: 'Reativar',
  },

  dashboard: {
    title: 'Dashboard',
    empty: 'Nenhum widget por aqui ainda.',
    emptyHint: 'Abra a paleta com Ctrl+K e escolha "Adicionar widget".',
    addWidget: 'Adicionar widget',
    removeWidget: 'Remover widget',
    syncNow: 'Sincronizar agora',
    layoutSaved: 'Layout salvo',
  },

  nav: {
    dashboard: 'Dashboard',
    automations: 'Automações',
    financial: 'Financeiro',
    team: 'Equipe',
  },

  automations: {
    title: 'Automações',
    empty: 'Nenhuma automação registrada ainda.',
    emptyHint: 'O log de execuções do n8n vai aparecer aqui assim que o webhook estiver conectado.',
  },

  financial: {
    title: 'Financeiro',
    empty: 'Nenhum dado financeiro conectado ainda.',
    emptyHint: 'Essa aba vai mostrar status de pagamento por cliente quando a integração for definida.',
  },

  widget: {
    updatedAgo: (relative: string) => `atualizado ${relative}`,
    neverSynced: 'nunca sincronizado',
    syncing: 'sincronizando...',
    retry: 'Tentar de novo',
    loadError: 'Nao foi possivel carregar este modulo.',
    readOnly: 'somente leitura',
  },

  status: {
    ok: 'ok',
    syncing: 'sync',
    error: 'erro',
    disabled: 'off',
  },

  edit: {
    save: 'Salvar',
    cancel: 'Cancelar',
    edit: 'Editar',
    undo: 'Desfazer',
    undone: 'Edicao desfeita.',
    savedBy: (name: string) => `editado por ${name}`,
    conflict: 'Esse dado mudou na origem depois que voce abriu a tela. Recarregue antes de salvar.',
    reload: 'Recarregar',
    undoWindow: (minutes: number) => `Desfazer disponivel por ${minutes} min`,
    saving: 'Salvando...',
    editHint: 'Modo de edicao ligado. Altere os campos e salve.',
    pendingChanges: 'Alteracoes nao salvas.',
    dismiss: 'Fechar aviso',
    undoLast: 'Desfazer ultima edicao',
  },

  view: {
    configure: 'Personalizar visualização',
    kindTable: 'Tabela',
    kindStatCards: 'Cartões',
    fieldsTitle: 'Campos visíveis',
    close: 'Fechar',
    reset: 'Mostrar todos',
  },

  palette: {
    placeholder: 'Buscar modulo, acao ou cliente...',
    empty: 'Nada encontrado.',
    sectionActions: 'Acoes',
    sectionWidgets: 'Adicionar widget',
    close: 'Fechar',
    toggleTheme: 'Alternar tema claro/escuro',
    signOut: 'Sair da conta',
  },

  errors: {
    notOwner: 'Apenas um owner do workspace pode gerenciar credenciais de connector.',
    notOwnerTeam: 'Apenas um owner do workspace pode gerenciar a equipe.',
    unauthorized: 'Sessao expirada. Entre novamente.',
    notFound: 'Nao encontrado.',
    invalidPayload: 'Requisicao invalida.',
  },
} as const;
