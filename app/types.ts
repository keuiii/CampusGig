export type Category = {
  id: string;
  name: string;
  serviceCount: number;
  icon?: string;
  color?: string;
};

export type Service = {
  id: string;
  title: string;
  provider: string;
  initials: string;
  program: string;
  school: string;
  schoolId: string;
  category: string;
  price: number;
  rating: number;
  reviews: number;
  delivery: string;
  color?: string;
  icon?: string;
  description: string;
};

export type School = {
  id: string;
  name: string;
  shortName: string;
  city: string;
};

export type Order = {
  id: string;
  service: string;
  client: string;
  amount: number;
  status: string;
  due: string;
};

export type Verification = {
  id: string;
  name: string;
  school: string;
  program: string;
  submitted: string;
  initials: string;
};

export type DashboardStats = {
  registeredStudents: number;
  activeServices: number;
  completedOrders: number;
  pendingVerifications: number;
};

export type ProviderStats = {
  activeOrders: number;
  pendingRequests: number;
  completedOrders: number;
  averageRating: number;
  reviewCount: number;
  profileStrength: number;
};
