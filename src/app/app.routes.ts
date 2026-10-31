import { Routes } from '@angular/router';
import { authGuard, fantaLeaderGuard, guestGuard, staffGuard } from './core/guards';

export const routes: Routes = [
  { path: 'invito/:token', loadComponent: () => import('./pages/invite').then((m) => m.InvitePage), title: 'Invito' },
  { path: 'accesso', canActivate: [guestGuard], loadComponent: () => import('./pages/login').then((m) => m.LoginPage), title: 'Accedi' },
  { path: 'nuova-password', loadComponent: () => import('./pages/new-password').then((m) => m.NewPasswordPage), title: 'Nuova password' },
  { path: 'in-attesa', loadComponent: () => import('./pages/pending').then((m) => m.PendingPage), title: 'In attesa' },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home').then((m) => m.HomePage), title: 'G.d.L.' },
      {
        path: 'partita/:id',
        loadComponent: () => import('./match/match-page').then((m) => m.MatchPage),
        children: [
          { path: '', loadComponent: () => import('./match/booking-tab').then((m) => m.BookingTab), title: 'Prenotazioni' },
          { path: 'squadre', loadComponent: () => import('./match/lineup-tab').then((m) => m.LineupTab), title: 'Squadre' },
          { path: 'risultato', loadComponent: () => import('./match/result-tab').then((m) => m.ResultTab), title: 'Risultato' },
          { path: 'voti', loadComponent: () => import('./match/votes-tab').then((m) => m.VotesTab), title: 'Pagelle' },
          { path: 'chat', loadComponent: () => import('./match/chat-tab').then((m) => m.ChatTab), title: 'Chat' },
        ],
      },
      { path: 'partite', loadComponent: () => import('./pages/matches').then((m) => m.MatchesPage), title: 'Partite' },
      { path: 'classifica', loadComponent: () => import('./pages/stats').then((m) => m.StatsPage), title: 'Classifica' },
      { path: 'giocatore/:id', loadComponent: () => import('./pages/player').then((m) => m.PlayerPage), title: 'Giocatore' },
      { path: 'avvisi', loadComponent: () => import('./pages/inbox').then((m) => m.InboxPage), title: 'Avvisi' },
      { path: 'profilo', loadComponent: () => import('./pages/profile').then((m) => m.ProfilePage), title: 'Profilo' },
      { path: 'gestione', canActivate: [staffGuard], loadComponent: () => import('./pages/admin').then((m) => m.AdminPage), title: 'Gestione' },
      { path: 'fantaleader', canActivate: [fantaLeaderGuard], loadComponent: () => import('./pages/fantaleader').then((m) => m.FantaLeaderPage), title: 'FantaLeader' },
    ],
  },
  { path: '**', redirectTo: '' },
];
