import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "class-validator";
import { UpdateStudentProfileDto } from "../src/modules/profile/dto/update-student-profile.dto";

function profileWithYear(yearLevel: number) {
  const profile = new UpdateStudentProfileDto();
  profile.schoolId = "9573b686-aaaa-4bbb-8ccc-123456789012";
  profile.program = "BS Information Technology";
  profile.yearLevel = yearLevel;
  return profile;
}

test("student year level accepts the supported first through sixth years", async () => {
  assert.equal((await validate(profileWithYear(1))).length, 0);
  assert.equal((await validate(profileWithYear(6))).length, 0);
});

test("student year level rejects values outside first through sixth year", async () => {
  assert.ok((await validate(profileWithYear(0))).length > 0);
  assert.ok((await validate(profileWithYear(7))).length > 0);
});
