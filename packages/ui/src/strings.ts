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

  dashboard: {
    title: 'Dashboard',
    empty: 'Nenhum widget por aqui ainda.',
    emptyHint: 'Abra a paleta com Ctrl+K e escolha "Adicionar widget".',
    addWidget: 'Adicionar widget',
    removeWidget: 'Remover widget',
    syncNow: 'Sincronizar agora',
    layoutSaved: 'Layout salvo',
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
    unauthorized: 'Sessao expirada. Entre novamente.',
    notFound: 'Nao encontrado.',
    invalidPayload: 'Requisicao invalida.',
  },
} as const;
