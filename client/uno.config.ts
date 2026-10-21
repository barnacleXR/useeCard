import { defineConfig, transformerDirectives, transformerVariantGroup } from 'unocss';
import { presetUi } from '@vean/unocss';
import { presetSoybean } from '@soybeanjs/unocss-preset';
export default defineConfig({presets: [presetSoybean(), presetUi()], transformers: [transformerDirectives(), transformerVariantGroup()]});
