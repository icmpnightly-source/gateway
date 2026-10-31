import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthState, LoginResponse, Role } from '@/types/auth.types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

function loadPersistedState(): AuthState {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);

    if (token && userRaw) {
      const user = JSON.parse(userRaw) as AuthState['user'];
      return {
        user,
        isAuthenticated: true,
        role: user?.role ?? null,
        token,
      };
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return {
    user: null,
    isAuthenticated: false,
    role: null,
    token: null,
  };
}

const initialState: AuthState = loadPersistedState();

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login(state, action: PayloadAction<LoginResponse>) {
      const { user, token } = action.payload;
      state.user = user;
      state.isAuthenticated = true;
      state.role = user.role as Role;
      state.token = token;

      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    logout(state) {
      state.user = null;
      state.isAuthenticated = false;
      state.role = null;
      state.token = null;

      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});

export const { login, logout } = authSlice.actions;
export default authSlice.reducer;
