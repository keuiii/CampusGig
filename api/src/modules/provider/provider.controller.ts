import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
@ApiTags("provider")
@Controller("provider")
export class ProviderController { @Get("dashboard") dashboard() { return { activeOrders: 0, pendingRequests: 0, completedOrders: 0, averageRating: 0, reviewCount: 0, profileStrength: 0 }; } }
