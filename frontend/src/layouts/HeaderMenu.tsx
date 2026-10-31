import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Divider, Popover, theme } from 'antd';
import { ChevronDown, LogIn, LogOut, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceControls } from '@/components/AppearanceControls';
import { ROUTES } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { logout } from '@/store/slices/authSlice';

/**
 * The one button at the header's end: behind it, how the app looks, and the
 * administrator's way in and out.
 */
export function HeaderMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { token: antdToken } = theme.useToken();
  // Whoever has not signed in is a user; the administrator is the one who has.
  const user = useAppSelector((state) => state.auth.user);
  const name = user ? user.username : t('roles.user');
  const [isOpen, setIsOpen] = useState(false);

  const signIn = () => {
    setIsOpen(false);
    navigate(ROUTES.LOGIN);
  };

  const signOut = () => {
    setIsOpen(false);
    dispatch(logout());
  };

  const panel = (
    <div className="flex w-64 flex-col">
      <div className="flex items-center gap-(--c-spacing-sm)">
        <Avatar
          size={32}
          icon={<User size={16} />}
          style={user ? { backgroundColor: antdToken.colorPrimary } : undefined}
        />
        <div className="min-w-0">
          <div className="truncate font-semibold">{name}</div>
          {user && <div className="text-(length:--c-font-size-sm) text-subtle">{t('roles.admin')}</div>}
        </div>
      </div>
      <Divider className="my-(--c-spacing-sm)!" />

      <AppearanceControls />

      <Divider className="my-(--c-spacing-sm)!" />

      {user ? (
        <Button danger type="text" icon={<LogOut size={16} />} onClick={signOut} className="justify-start!">
          {t('logout')}
        </Button>
      ) : (
        <Button icon={<LogIn size={16} />} onClick={signIn}>
          {t('login.adminSignIn')}
        </Button>
      )}
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      arrow={false}
      open={isOpen}
      onOpenChange={setIsOpen}
      content={panel}
    >
      <Button type="text" aria-label={t('menu.open')} className="flex h-auto! items-center gap-(--c-spacing-xs) px-(--c-spacing-xs)! py-(--c-spacing-xxs)!">
        <Avatar
          size={28}
          icon={<User size={14} />}
          style={user ? { backgroundColor: antdToken.colorPrimary } : undefined}
        />
        <span className="font-medium">{name}</span>
        <ChevronDown size={14} className="text-subtle" />
      </Button>
    </Popover>
  );
}
