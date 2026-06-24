package com.englishapp.api;

import com.englishapp.service.CurrentUserService;
import com.englishapp.service.MeaningGroupService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class MeaningGroupController {
    private final CurrentUserService currentUserService;
    private final MeaningGroupService meaningGroupService;

    public MeaningGroupController(CurrentUserService currentUserService, MeaningGroupService meaningGroupService) {
        this.currentUserService = currentUserService;
        this.meaningGroupService = meaningGroupService;
    }

    @GetMapping("/meaning-groups")
    public List<Map<String, Object>> getMeaningGroups() {
        return meaningGroupService.getMeaningGroups(currentUserService.getCurrentUserId());
    }

    @GetMapping("/meaning-groups/{groupId}")
    public Map<String, Object> getMeaningGroup(@PathVariable Long groupId) {
        return meaningGroupService.getMeaningGroup(groupId, currentUserService.getCurrentUserId());
    }

    @PostMapping("/meaning-groups")
    public Map<String, Object> createMeaningGroup(@RequestBody MeaningGroupRequest request) {
        return meaningGroupService.createMeaningGroup(
                currentUserService.getCurrentUser(),
                request.label(),
                request.notes()
        );
    }

    @PutMapping("/meaning-groups/{groupId}")
    public Map<String, Object> updateMeaningGroup(
            @PathVariable Long groupId,
            @RequestBody MeaningGroupRequest request
    ) {
        return meaningGroupService.updateMeaningGroup(
                groupId,
                currentUserService.getCurrentUserId(),
                request.label(),
                request.notes()
        );
    }

    @DeleteMapping("/meaning-groups/{groupId}")
    public ResponseEntity<Void> deleteMeaningGroup(@PathVariable Long groupId) {
        meaningGroupService.deleteMeaningGroup(groupId, currentUserService.getCurrentUserId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/meaning-groups/{groupId}/sentences")
    public List<Map<String, Object>> getSentencesInGroup(@PathVariable Long groupId) {
        return meaningGroupService.getSentencesInGroup(groupId, currentUserService.getCurrentUserId());
    }

    @GetMapping("/sentences/{sentenceId}/variants")
    public List<Map<String, Object>> getSentenceVariants(@PathVariable Long sentenceId) {
        return meaningGroupService.getSentenceVariants(sentenceId, currentUserService.getCurrentUserId());
    }

    @PutMapping("/sentences/{sentenceId}/meaning-group")
    public Map<String, Object> assignSentenceToMeaningGroup(
            @PathVariable Long sentenceId,
            @RequestBody @Valid AssignMeaningGroupRequest request
    ) {
        return meaningGroupService.assignSentenceToMeaningGroup(
                sentenceId,
                request.groupId(),
                currentUserService.getCurrentUserId()
        );
    }

    @DeleteMapping("/sentences/{sentenceId}/meaning-group")
    public Map<String, Object> unassignSentenceFromMeaningGroup(@PathVariable Long sentenceId) {
        return meaningGroupService.unassignSentenceFromMeaningGroup(
                sentenceId,
                currentUserService.getCurrentUserId()
        );
    }

    public record MeaningGroupRequest(String label, String notes) {
    }

    public record AssignMeaningGroupRequest(@NotNull Long groupId) {
    }
}
