import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { VerificationService } from "../profile/verification.service";
import { RejectVerificationDto } from "./dto/reject-verification.dto";
import { RejectServiceDto } from "./dto/reject-service.dto";
import { AdminService } from "./admin.service";
import { AssignSchoolAdminDto } from "./dto/assign-school-admin.dto";
import { CursorPageDto } from "../../common/cursor-page.dto";
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly verificationsService: VerificationService,
    private readonly adminService: AdminService,
    private readonly storage: StorageService,
  ) {}
  @Get("dashboard") dashboard() {
    return this.adminService.dashboard();
  }
  @Get("verifications")
  @Roles(UserRole.ADMIN, UserRole.SCHOOL_ADMIN)
  verifications(
    @Req() request: AuthenticatedRequest,
    @Query() query: CursorPageDto,
  ) {
    return this.verificationsService.listPending(
      request.auth.sub,
      request.auth.roles.includes(UserRole.ADMIN),
      query.cursor,
      query.limit,
    );
  }
  @Get("services") services(@Query() query: CursorPageDto) {
    return this.adminService.listPendingServices(query.cursor, query.limit);
  }
  @Get("verifications/:id/document")
  @Roles(UserRole.ADMIN, UserRole.SCHOOL_ADMIN)
  async document(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const filename = await this.verificationsService.getDocument(
      id,
      request.auth.sub,
      request.auth.roles.includes(UserRole.ADMIN),
    );
    return sendStoredFile(
      response,
      await this.storage.delivery("student-ids", filename),
    );
  }
  @Post("verifications/:id/approve")
  @Roles(UserRole.ADMIN, UserRole.SCHOOL_ADMIN)
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.verificationsService.review(
      id,
      request.auth.sub,
      true,
      undefined,
      request.auth.roles.includes(UserRole.ADMIN),
    );
  }
  @Post("verifications/:id/reject")
  @Roles(UserRole.ADMIN, UserRole.SCHOOL_ADMIN)
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: RejectVerificationDto,
  ) {
    return this.verificationsService.review(
      id,
      request.auth.sub,
      false,
      input.reason,
      request.auth.roles.includes(UserRole.ADMIN),
    );
  }
  @Post("services/:id/approve") approveService(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.reviewService(id, request.auth.sub, true);
  }
  @Post("services/:id/reject") rejectService(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: RejectServiceDto,
  ) {
    return this.adminService.reviewService(
      id,
      request.auth.sub,
      false,
      input.reason,
    );
  }
  @Get("school-admins") schoolAdmins(@Query() query: CursorPageDto) {
    return this.adminService.listSchoolAdmins(query.cursor, query.limit);
  }
  @Post("school-admins") assignSchoolAdmin(
    @Body() input: AssignSchoolAdminDto,
  ) {
    return this.adminService.assignSchoolAdmin(input.email, input.schoolId);
  }
  @Delete("school-admins/:userId") removeSchoolAdmin(
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.removeSchoolAdmin(userId);
  }
}
