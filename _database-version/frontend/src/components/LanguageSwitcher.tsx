import { Select } from "antd";
import { useTranslation } from "react-i18next";

const languages = [
  { code: "uz", label: "O'zbekcha" },
  { code: "ru", label: "Русский" },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language;

  const handleChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem("lang", value);
  };

  return (
    <Select
      value={current}
      onChange={handleChange}
      style={{ width: 120 }}
      options={languages.map(({ code, label }) => ({
        value: code,
        label,
      }))}
    />
  );
}
