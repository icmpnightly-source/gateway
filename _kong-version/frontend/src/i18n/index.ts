import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import uz from './locales/uz.json'
import ru from './locales/ru.json'

const savedLang = localStorage.getItem('lang') || 'uz'

i18n.use(initReactI18next).init({
  resources: {
    uz: { translation: uz },
    ru: { translation: ru },
  },
  lng: savedLang,
  fallbackLng: 'uz',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('lang', lng)
})

export default i18n
