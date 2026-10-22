import type { ThemePresetColors } from '@vean/ui';
export const presetName = 'Luxury Obsidian Gold';
export const presetValue = 'luxury-obsidian-gold';
// 完整语义配色：金色强调、暖白文字与黑曜石表面；浅色模式使用象牙白与深金。
export const colors: ThemePresetColors = {
  light: {
    background:'hsl(43.636 40.741% 94.706%)', card:'hsl(45.000 100.000% 98.431%)', popover:'hsl(45.000 100.000% 98.431%)',
    foreground:'hsl(40.000 17.143% 13.725%)', 'muted-foreground':'hsl(41.538 13.000% 39.216%)', 'card-foreground':'hsl(40.000 17.143% 13.725%)', 'popover-foreground':'hsl(40.000 17.143% 13.725%)',
    primary:'hsl(40.000 62.195% 32.157%)', 'primary-foreground':'hsl(0.000 0.000% 100.000%)', ring:'hsl(40.000 52.607% 41.373%)',
    muted:'hsl(42.000 34.483% 88.627%)', accent:'hsl(42.857 45.455% 84.902%)', 'accent-foreground':'hsl(38.491 53.535% 19.412%)', secondary:'hsl(42.581 40.260% 84.902%)', 'secondary-foreground':'hsl(38.491 53.535% 19.412%)',
    border:'hsl(41.429 33.871% 75.686%)', input:'hsl(42.162 35.922% 79.804%)',
    sidebar:'hsl(44.211 38.776% 90.392%)', 'sidebar-foreground':'hsl(34.286 22.581% 18.235%)', 'sidebar-border':'hsl(41.429 33.871% 75.686%)',
    'sidebar-accent':'hsl(42.581 40.260% 84.902%)', 'sidebar-accent-foreground':'hsl(37.742 53.448% 22.745%)', 'sidebar-primary':'hsl(40.000 62.195% 32.157%)', 'sidebar-primary-foreground':'hsl(0.000 0.000% 100.000%)', 'sidebar-ring':'hsl(40.000 52.607% 41.373%)',
  },
  dark: {
    background:'hsl(220.000 10.345% 5.686%)', card:'hsl(225.000 8.000% 9.804%)', popover:'hsl(225.000 6.452% 12.157%)',
    foreground:'hsl(42.000 38.462% 89.804%)', 'muted-foreground':'hsl(40.000 13.793% 65.882%)', 'card-foreground':'hsl(42.000 38.462% 89.804%)', 'popover-foreground':'hsl(42.000 38.462% 89.804%)',
    primary:'hsl(41.143 56.150% 63.333%)', 'primary-foreground':'hsl(40.000 31.579% 7.451%)', ring:'hsl(41.143 56.150% 63.333%)',
    muted:'hsl(225.000 5.556% 14.118%)', accent:'hsl(45.000 16.216% 14.510%)', 'accent-foreground':'hsl(41.684 65.517% 71.569%)', secondary:'hsl(45.000 16.216% 14.510%)', 'secondary-foreground':'hsl(41.684 65.517% 71.569%)',
    border:'hsl(40.800 38.071% 61.373%)', input:'hsl(42.857 16.535% 24.902%)',
    sidebar:'hsl(220.000 8.571% 6.863%)', 'sidebar-foreground':'hsl(40.800 26.882% 81.765%)', 'sidebar-border':'hsl(40.800 38.071% 61.373%)',
    'sidebar-accent':'hsl(42.857 20.588% 13.333%)', 'sidebar-accent-foreground':'hsl(41.684 65.517% 71.569%)', 'sidebar-primary':'hsl(41.143 56.150% 63.333%)', 'sidebar-primary-foreground':'hsl(40.000 31.579% 7.451%)', 'sidebar-ring':'hsl(41.143 56.150% 63.333%)',
  },
};
