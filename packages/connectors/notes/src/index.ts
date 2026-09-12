// Importing this package registers the connector as a side effect.
export { notesConnector, type NotesConfig } from './connector';
export { createMemoryStore, createRedisStore, setNoteStore, type NoteState, type NoteStore } from './store';
