import { storage } from '#imports';

// Type-safe storage helper
export const browserStorage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      return await storage.getItem<T>(`local:${key}`);
    } catch (error) {
      console.error('Storage get error:', error);
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await storage.setItem(`local:${key}`, value);
    } catch (error) {
      console.error('Storage set error:', error);
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await storage.removeItem(`local:${key}`);
    } catch (error) {
      console.error('Storage remove error:', error);
    }
  },

  onChange<T>(key: string, callback: (newValue: T | null) => void) {
    const unwatch = storage.watch<T>(`local:${key}`, (newValue) => {
      callback(newValue);
    });
    return unwatch;
  },
};