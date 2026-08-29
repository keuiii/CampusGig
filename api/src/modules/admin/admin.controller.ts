import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
@ApiTags("admin")
@Controller("admin")
export class AdminController {
  @Get("dashboard") dashboard() { return { registeredStudents: 0, activeServices: 0, completedOrders: 0, pendingVerifications: 0 }; }
  @Get("verifications") verifications() { return { data: [] }; }
  @Post("verifications/:id/approve") approve(@Param("id") id: string) { return { id, status: "APPROVED" }; }
  @Post("verifications/:id/reject") reject(@Param("id") id: string) { return { id, status: "REJECTED" }; }
}
