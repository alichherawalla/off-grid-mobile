import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Persona } from '../types';

interface PersonaState {
  personas: Persona[];

  // Actions
  createPersona: (persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => Persona;
  updatePersona: (id: string, updates: Partial<Omit<Persona, 'id' | 'createdAt'>>) => void;
  deletePersona: (id: string) => void;
  getPersona: (id: string) => Persona | undefined;
  duplicatePersona: (id: string) => Persona | null;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Default personas
const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'default-assistant',
    name: 'Default Assistant',
    description: 'A helpful, concise AI assistant',
    systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
    icon: '🤖',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'creative-writer',
    name: 'Creative Writer',
    description: 'A creative writing assistant for stories and content',
    systemPrompt: 'You are a creative writing assistant. Help the user with storytelling, creative content, poetry, and imaginative writing. Be descriptive, use vivid language, and help bring ideas to life.',
    icon: '✍️',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'code-expert',
    name: 'Code Expert',
    description: 'A programming and software development expert',
    systemPrompt: 'You are an expert software developer. Help the user with coding questions, debugging, code reviews, and software architecture. Provide clean, well-documented code examples. Explain technical concepts clearly.',
    icon: '💻',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tutor',
    name: 'Patient Tutor',
    description: 'An educational tutor that explains concepts step by step',
    systemPrompt: 'You are a patient and encouraging tutor. Explain concepts step by step, use analogies and examples to make things clear. Ask questions to check understanding. Adapt your explanations to the user\'s level.',
    icon: '📚',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const usePersonaStore = create<PersonaState>()(
  persist(
    (set, get) => ({
      personas: DEFAULT_PERSONAS,

      createPersona: (personaData) => {
        const persona: Persona = {
          ...personaData,
          id: generateId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          personas: [...state.personas, persona],
        }));

        return persona;
      },

      updatePersona: (id, updates) => {
        set((state) => ({
          personas: state.personas.map((persona) =>
            persona.id === id
              ? { ...persona, ...updates, updatedAt: new Date().toISOString() }
              : persona
          ),
        }));
      },

      deletePersona: (id) => {
        // Don't delete default personas
        if (id.startsWith('default-') || id === 'creative-writer' || id === 'code-expert' || id === 'tutor') {
          return;
        }
        set((state) => ({
          personas: state.personas.filter((persona) => persona.id !== id),
        }));
      },

      getPersona: (id) => {
        return get().personas.find((persona) => persona.id === id);
      },

      duplicatePersona: (id) => {
        const original = get().getPersona(id);
        if (!original) return null;

        const duplicate: Persona = {
          ...original,
          id: generateId(),
          name: `${original.name} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          personas: [...state.personas, duplicate],
        }));

        return duplicate;
      },
    }),
    {
      name: 'local-llm-persona-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
